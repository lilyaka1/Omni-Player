"""
Piper TTS generation via subprocess + asyncio.
Minimal dependencies: only standard library + external binaries (piper, ffmpeg, ffprobe).
"""
import asyncio
import hashlib
import os
import re
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
TTS_AUDIO_DIR: Path = Path(os.getenv(
    "TTS_AUDIO_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "tts_audio"),
))
TTS_MODEL_DIR: Path = Path(os.getenv("TTS_MODEL_DIR", ""))
MAX_CONCURRENT = int(os.getenv("TTS_MAX_CONCURRENT", "2"))
GENERATION_TIMEOUT_SEC = 15
PIPER_BIN = os.getenv("PIPER_BIN", "piper")

# Semaphore: не больше N параллельных Piper процессов
_tts_semaphore: Optional[asyncio.Semaphore] = None


def _get_semaphore() -> asyncio.Semaphore:
    global _tts_semaphore
    if _tts_semaphore is None:
        _tts_semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    return _tts_semaphore


# ── Result ──────────────────────────────────────────────────────────────────
@dataclass
class TTSResult:
    success: bool
    audio_path: Optional[str] = None
    duration_sec: Optional[float] = None
    error: Optional[str] = None


# ── Helpers ─────────────────────────────────────────────────────────────────
async def _get_duration(path: Path) -> Optional[float]:
    """FFprobe: точная длительность в секундах."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except (ValueError, UnicodeDecodeError):
        return None


async def _convert_wav_to_mp3(wav_path: Path, mp3_path: Path) -> bool:
    """FFmpeg: wav → mp3 128k."""
    TTS_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-i", str(wav_path),
        "-b:a", "128k",
        str(mp3_path),
        "-loglevel", "quiet",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    code = await proc.wait()
    return code == 0


def _content_hash(text: str, voice_id: str) -> str:
    return hashlib.sha256(f"{text}:{voice_id}".encode()).hexdigest()[:16]


def _resolve_model_path(voice_id: str) -> Optional[Path]:
    """Найти модель: сначала TTS_MODEL_DIR, потом в PATH."""
    # 1. Явный путь
    if TTS_MODEL_DIR:
        explicit = TTS_MODEL_DIR / voice_id
        if explicit.exists():
            return explicit
        # может быть файл напрямую
        if explicit.suffix == ".onnx" and explicit.exists():
            return explicit

    # 2. Имя файла в PATH или /app/tts_models/
    for base in [Path("/app/tts_models"), Path("/usr/local/share/piper"), Path("/usr/share/piper")]:
        for ext in ("", ".onnx"):
            candidate = base / f"{voice_id}{ext}"
            if candidate.exists():
                return candidate
        # Модель может лежать как voice_id/voice_id.onnx
        subdir = base / voice_id
        if subdir.is_dir():
            onnx_files = list(subdir.glob("*.onnx"))
            if onnx_files:
                return onnx_files[0]

    return None


# ── Main generator ──────────────────────────────────────────────────────────
async def generate_speech(
    text: str,
    voice_id: str = "en_US-libritts-high",
) -> TTSResult:
    """
    Piper TTS → MP3.

    Pipeline:
      1. Хеш → cache check
      2. Найти модель
      3. piper subprocess (wav)
      4. ffmpeg → mp3
      5. ffprobe → duration
    """
    text = text.strip()
    if not text:
        return TTSResult(success=False, error="Empty text")

    content_hash = _content_hash(text, voice_id)
    TTS_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    mp3_path = TTS_AUDIO_DIR / f"{content_hash}.mp3"

    # ── Cache hit ──────────────────────────────────────────────────────
    if mp3_path.exists() and mp3_path.stat().st_size > 100:
        dur = await _get_duration(mp3_path)
        return TTSResult(success=True, audio_path=str(mp3_path), duration_sec=dur)

    # ── Find model ──────────────────────────────────────────────────────
    model_path = _resolve_model_path(voice_id)
    if model_path is None:
        # Пробуем дефолтную
        voice_id = "en_US-libritts-high"
        model_path = _resolve_model_path(voice_id)
        if model_path is None:
            return TTSResult(success=False, error=f"Model not found: {voice_id}")

    wav_path = TTS_AUDIO_DIR / f"{content_hash}.wav"

    # ── Piper subprocess ────────────────────────────────────────────────
    try:
        async with _get_semaphore():
            proc = await asyncio.create_subprocess_exec(
                PIPER_BIN,
                "--model", str(model_path),
                "--output_file", str(wav_path),
                "--sentence_silence", "0.2",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            _, err = await asyncio.wait_for(
                proc.communicate(input=text.encode("utf-8")),
                timeout=GENERATION_TIMEOUT_SEC,
            )

    except asyncio.TimeoutError:
        log.warning(f"Piper timeout (>15s): {text[:40]}")
        try:
            proc.kill()
        except Exception:
            pass
        return TTSResult(success=False, error="Generation timeout (>15s)")

    except FileNotFoundError:
        return TTSResult(success=False, error="Piper binary not found. Install piper-tts.")

    except OSError as e:
        if e.errno == 28:
            return TTSResult(success=False, error="Disk full")
        return TTSResult(success=False, error=str(e))

    except Exception as e:
        return TTSResult(success=False, error=str(e))

    # ── Check output ────────────────────────────────────────────────────
    if proc.returncode != 0:
        err_msg = err.decode(errors="replace").strip()
        log.warning(f"Piper error: {err_msg}")

        # Попытка очистить текст от проблемных символов и повторить один раз
        cleaned = re.sub(r"[^\w\sа-яёА-ЯЁ.,!?'-]", " ", text)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned and cleaned != text:
            log.info(f"Retrying with cleaned text: {cleaned[:60]}")
            return await generate_speech(cleaned, voice_id)

        return TTSResult(success=False, error=f"Piper error: {err_msg[:100]}")

    if not wav_path.exists() or wav_path.stat().st_size < 100:
        return TTSResult(success=False, error="Wav file missing or empty")

    # ── FFmpeg: wav → mp3 ───────────────────────────────────────────────
    ok = await _convert_wav_to_mp3(wav_path, mp3_path)
    if not ok:
        return TTSResult(success=False, error="FFmpeg conversion failed")

    # ── Cleanup wav ─────────────────────────────────────────────────────
    try:
        wav_path.unlink()
    except OSError:
        pass

    # ── Duration ─────────────────────────────────────────────────────────
    dur = await _get_duration(mp3_path)

    log.info(f"TTS generated: {content_hash} ({dur if dur is not None else 0:.1f}s)")
    return TTSResult(success=True, audio_path=str(mp3_path), duration_sec=dur)


# ── Pre-generation (for cache warming) ─────────────────────────────────────
COMMON_PHRASES = [
    "Всем привет! Сейчас играет",
    "Следующий трек",
    "Не переключайте!",
    "Спасибо за прослушивание",
    "Добро пожаловать",
]


async def prewarm_cache() -> int:
    """Генерирует COMMON_PHRASES в фоне. Вызывается при старте приложения."""
    generated = 0
    for phrase in COMMON_PHRASES:
        h = _content_hash(phrase, "en_US-libritts-high")
        path = TTS_AUDIO_DIR / f"{h}.mp3"
        if path.exists():
            continue
        result = await generate_speech(phrase)
        if result.success:
            generated += 1
            log.info(f"Prewarmed: {phrase[:40]}")
        else:
            log.warning(f"Prewarm failed: {phrase[:40]} - {result.error}")
    return generated
