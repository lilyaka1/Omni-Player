"""
Piper TTS + SO-VITS-SVC pipeline для Omni Player.
Minimal deps: piper-tts, so-vits-svc-fork, ffmpeg.
"""
import asyncio
import hashlib
import os
import re
import shutil
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
_backend_root = Path(__file__).parent.parent.parent
TTS_AUDIO_DIR: Path = Path(os.getenv("TTS_AUDIO_DIR", str(_backend_root / "tts_audio")))
TTS_MODEL_DIR: Path = Path(os.getenv("TTS_MODEL_DIR", str(_backend_root / "tts_models")))
RVC_MODEL_DIR: Path = Path(os.getenv(
    "RVC_MODEL_DIR",
    str(_backend_root.parent / "Kanye West - Weights Model" / "Kanye West (RVC) 1000 Epoch"),
))
RVC_ENABLED = os.getenv("RVC_ENABLED", "true").lower() == "true"
RVC_DEVICE = os.getenv("RVC_DEVICE", "cpu")
MAX_CONCURRENT = int(os.getenv("TTS_MAX_CONCURRENT", "2"))
GENERATION_TIMEOUT_SEC = int(os.getenv("TTS_TIMEOUT_SEC", "30"))


def _resolve_piper_bin() -> str:
    env_bin = os.getenv("PIPER_BIN")
    if env_bin:
        if os.path.isfile(env_bin) and os.access(env_bin, os.X_OK):
            return env_bin
        found = shutil.which(env_bin)
        if found:
            return found

    venv_bin = _backend_root / "venv" / "bin" / "piper"
    if venv_bin.exists() and os.access(venv_bin, os.X_OK):
        return str(venv_bin)

    found = shutil.which("piper")
    if found:
        return found

    return "piper"


PIPER_BIN = _resolve_piper_bin()
log.info(f"Piper binary resolved to: {PIPER_BIN}")


# ── Semaphores ──────────────────────────────────────────────────────────────
_tts_semaphore: Optional[asyncio.Semaphore] = None
_rvc_semaphore: Optional[asyncio.Semaphore] = None


def _get_tts_semaphore() -> asyncio.Semaphore:
    global _tts_semaphore
    if _tts_semaphore is None:
        _tts_semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    return _tts_semaphore


def _get_rvc_semaphore() -> asyncio.Semaphore:
    global _rvc_semaphore
    if _rvc_semaphore is None:
        _rvc_semaphore = asyncio.Semaphore(1)  # SO-VITS heavy → 1 за раз
    return _rvc_semaphore


# ── Lazy SO-VITS engine ──────────────────────────────────────────────────────
_sovits_engine = None
_sovits_init_lock = asyncio.Lock()


async def _get_sovits_engine():
    """Ленивая инициализация SO-VITS-SVC движка."""
    global _sovits_engine
    if _sovits_engine is not None:
        return _sovits_engine

    async with _sovits_init_lock:
        if _sovits_engine is not None:
            return _sovits_engine

        if not RVC_ENABLED:
            return None

        if not (RVC_MODEL_DIR / "model.pth").exists():
            log.warning(f"RVC model not found at {RVC_MODEL_DIR}, RVC disabled")
            return None

        def _load():
            from .rvc_sovits import SOVITSRVCEngine
            return SOVITSRVCEngine(str(RVC_MODEL_DIR), device=RVC_DEVICE)

        try:
            _sovits_engine = await asyncio.to_thread(_load)
            log.info("✅ SO-VITS engine ready (lazy)")
        except Exception as e:
            log.error(f"❌ SO-VITS init failed: {e}")
            _sovits_engine = None

    return _sovits_engine


# ── Result ──────────────────────────────────────────────────────────────────
@dataclass
class TTSResult:
    success: bool
    audio_path: Optional[str] = None
    duration_sec: Optional[float] = None
    error: Optional[str] = None
    is_kanye: bool = False  # True если применён RVC

    @property
    def used_rvc(self) -> bool:
        return self.is_kanye


# ── Helpers ─────────────────────────────────────────────────────────────────
async def _get_duration(path: Path) -> Optional[float]:
    """FFprobe: длительность в секундах."""
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


def _content_hash(text: str, voice_id: str, use_rvc: bool = True) -> str:
    suffix = "_rvc" if use_rvc else "_base"
    return hashlib.sha256(f"{text}:{voice_id}{suffix}".encode()).hexdigest()[:16]


def _resolve_model_path(voice_id: str) -> Optional[Path]:
    """Найти Piper модель."""
    for base in [TTS_MODEL_DIR, _backend_root / "tts_models", _backend_root.parent / "tts_models"]:
        if not base.exists():
            continue
        for ext in ("", ".onnx"):
            candidate = base / f"{voice_id}{ext}"
            if candidate.exists():
                return candidate
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
    use_rvc: bool = True,
    rvc_pitch: int = 0,
    index_rate: float = 0.75,
    protect: float = 0.33,  # совместимость со старым API
) -> TTSResult:
    """
    Piper TTS → WAV → [SO-VITS RVC] → MP3.
    """
    text = text.strip()
    if not text:
        return TTSResult(success=False, error="Empty text")

    TTS_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    will_use_rvc = use_rvc and RVC_ENABLED
    content_hash = _content_hash(text, voice_id, will_use_rvc)

    # Cache check
    final_mp3 = TTS_AUDIO_DIR / f"{content_hash}.mp3"
    if final_mp3.exists() and final_mp3.stat().st_size > 100:
        dur = await _get_duration(final_mp3)
        return TTSResult(
            success=True, audio_path=str(final_mp3),
            duration_sec=dur, is_kanye=will_use_rvc,
        )

    # Find Piper model
    model_path = _resolve_model_path(voice_id)
    if model_path is None:
        voice_id = "en_US-libritts-high"
        model_path = _resolve_model_path(voice_id)
        if model_path is None:
            return TTSResult(success=False, error=f"Model not found: {voice_id}")

    base_wav = TTS_AUDIO_DIR / f"{content_hash}_base.wav"
    rvc_wav = TTS_AUDIO_DIR / f"{content_hash}_rvc.wav"

    # ── Piper TTS ──────────────────────────────────────────────────────
    try:
        async with _get_tts_semaphore():
            proc = await asyncio.create_subprocess_exec(
                PIPER_BIN,
                "--model", str(model_path),
                "--output_file", str(base_wav),
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
        log.warning(f"Piper timeout: {text[:40]}")
        try:
            proc.kill()
        except Exception:
            pass
        return TTSResult(success=False, error="Generation timeout")
    except FileNotFoundError:
        return TTSResult(success=False, error="Piper binary not found")
    except Exception as e:
        return TTSResult(success=False, error=str(e))

    if proc.returncode != 0:
        err_msg = err.decode(errors="replace").strip()
        cleaned = re.sub(r"[^\w\sа-яёА-ЯЁ.,!?'-]", " ", text)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned and cleaned != text:
            return await generate_speech(
                cleaned, voice_id, use_rvc,
                rvc_pitch=rvc_pitch, index_rate=index_rate, protect=protect,
            )
        return TTSResult(success=False, error=f"Piper error: {err_msg[:120]}")

    if not base_wav.exists() or base_wav.stat().st_size < 100:
        return TTSResult(success=False, error="Wav file missing or empty")

    # ── SO-VITS-SVC ───────────────────────────────────────────────────
    rvc_applied = False
    rvc_source: Optional[Path] = None
    if will_use_rvc:
        engine = await _get_sovits_engine()
        if engine is not None:
            async with _get_rvc_semaphore():
                def _convert():
                    return engine.convert_voice(
                        str(base_wav), str(rvc_wav),
                        index_rate=index_rate, pitch_shift=rvc_pitch,
                    )
                try:
                    ok = await asyncio.to_thread(_convert)
                except Exception as e:
                    log.error(f"SO-VITS conversion error: {e}")
                    ok = False

            if ok and rvc_wav.exists() and rvc_wav.stat().st_size > 100:
                rvc_applied = True
                rvc_source = rvc_wav
            else:
                log.warning("SO-VITS failed, falling back to base voice")

    # ── Encode to MP3 ───────────────────────────────────────────────────
    source_wav = rvc_source if rvc_applied else base_wav
    ok = await _convert_wav_to_mp3(source_wav, final_mp3)
    if not ok:
        return TTSResult(success=False, error="FFmpeg encoding failed")

    # Cleanup temp wavs
    for f in (base_wav, rvc_wav):
        try:
            f.unlink()
        except OSError:
            pass

    dur = await _get_duration(final_mp3)
    log.info(f"TTS generated: {content_hash} ({dur:.1f}s, rvc={rvc_applied})")
    return TTSResult(
        success=True, audio_path=str(final_mp3),
        duration_sec=dur, is_kanye=rvc_applied,
    )


# ── Pre-generation ──────────────────────────────────────────────────────────
COMMON_PHRASES = [
    "Всем привет! Сейчас играет",
    "Следующий трек",
    "Не переключайте!",
    "Спасибо за прослушивание",
    "Добро пожаловать",
]


async def prewarm_cache() -> int:
    """Генерирует COMMON_PHRASES при старте приложения."""
    generated = 0
    for phrase in COMMON_PHRASES:
        h = _content_hash(phrase, "en_US-libritts-high", use_rvc=True)
        path = TTS_AUDIO_DIR / f"{h}.mp3"
        if path.exists():
            continue
        result = await generate_speech(phrase, use_rvc=True)
        if result.success:
            generated += 1
            log.info(f"Prewarmed: {phrase[:40]}")
        else:
            log.warning(f"Prewarm failed: {phrase[:40]} - {result.error}")
    return generated


# ── TTS Manager wrapper ─────────────────────────────────────────────────────
class TTSManager:
    def __init__(self):
        self.model_name = "en_US-libritts-high"
        self.device = RVC_DEVICE
        self._initialized = True

    def is_initialized(self):
        return True

    def initialize(self, model_name="en_US-libritts-high", device="cpu"):
        self.model_name = model_name
        self.device = device
        return True

    def generate(self, text, speaker_id=None):
        return asyncio.run(generate_speech(text, voice_id=self.model_name))

    def get_available_models(self):
        return ["en_US-libritts-high"]


tts_manager = TTSManager()
