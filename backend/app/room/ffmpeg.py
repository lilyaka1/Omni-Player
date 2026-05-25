"""
ffmpeg streaming — транскодирование аудио и передача чанков слушателям.
Источник: либо локальный файл, либо HTTP/HLS URL.
"""
import asyncio
import os
import time as _t
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.room.room_state import RoomState as RoomBroadcast

# Минимум байт для «нормального» трека (меньше — обрыв)
_MIN_BYTES = 100 * 1024

# Размер чанка: 8KB ≈ 0.5с при 128kbps
_CHUNK_SIZE = 8 * 1024


def _is_local_path(src: str) -> bool:
    if not src:
        return False
    return not src.startswith(('http://', 'https://'))


def _is_raw_aac(src: str) -> bool:
    """Raw .aac файл — имеет ADTS заголовки, но браузеру нужен чистый AAC."""
    if not src:
        return False
    return src.lower().endswith('.aac')


def _is_mp4_aac(src: str) -> bool:
    """MP4/M4A контейнер — браузер играет напрямую без перекодирования."""
    if not src:
        return False
    return src.lower().endswith(('.m4a', '.mp4'))


def _build_cmd(src: str) -> list[str]:
    """Команда ffmpeg для конкретного источника."""
    base = ['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-re']

    if not _is_local_path(src):
        # HTTP / HLS источник: эмулируем браузер
        base += [
            '-headers', 'Referer: https://soundcloud.com/\r\nOrigin: https://soundcloud.com\r\n',
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ]

    # Raw .aac файлы: реэнкодим → чистый AAC поток (без ADTS заголовка для браузера)
    if _is_raw_aac(src):
        return base + [
            '-i', src,
            '-vn',
            '-map_metadata', '-1',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'adts',
            '-',
        ]

    # MP4/M4A контейнеры: копируем дорожку, извлекаем AAC → ADTS для браузера
    if _is_mp4_aac(src):
        return base + [
            '-i', src,
            '-vn',
            '-map_metadata', '-1',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'adts',
            '-',
        ]

    # MP3 и всё остальное: реэнкодим в AAC
    return base + [
        '-i', src,
        '-vn',
        '-map_metadata', '-1',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'adts',
        '-',
    ]


async def stream_ffmpeg(bc: "RoomBroadcast", src: str):
    """
    Запускает ffmpeg, транскодирует в MP3, льёт чанки в broadcast.

    src — путь к файлу или http(s) URL.

    Возвращает:
      True      — трек дошёл до конца естественно
      False     — bc.running стал False (остановили снаружи)
      "skipped" — admin нажал skip
      "expired" — источник недоступен (для URL — 401/403/404, для файла — отсутствует)
    """
    bc._ring_buffer.clear()
    _t0 = _t.perf_counter()

    if _is_local_path(src):
        if not os.path.isfile(src):
            print(f"❌ [ffmpeg] file not found: {src}")
            return "expired"

    cmd = _build_cmd(src)
    process = None
    bytes_sent = 0

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        print(f"⏱  [ffmpeg] +{((_t.perf_counter()-_t0)*1000):.0f}ms process started "
              f"(pid={process.pid}, src={'file' if _is_local_path(src) else 'url'})")

        first_chunk = True
        _chunk_count = 0
        while bc.running and not bc.skip_event.is_set():
            try:
                chunk = await asyncio.wait_for(process.stdout.read(_CHUNK_SIZE), timeout=15.0)
            except asyncio.TimeoutError:
                print(f"⚠️ [ffmpeg] read timeout — aborting")
                break

            if not chunk:
                break

            if first_chunk:
                first_chunk = False
                # ── Быстрая валидация first chunk ──
                # ADTS AAC frame начинается с 0xFF 0xF? (sync word)
                # MP3 frame начинается с 0xFF (sync) или 0x49/0x4D (ID3)
                # Если first chunk слишком мал или не похож на аудио — файл битый
                if len(chunk) < 128:
                    stderr_str = await _read_stderr(process)
                    print(f"⚠️ [ffmpeg] first chunk too small ({len(chunk)}b) → likely broken source")
                    print(f"   stderr: {stderr_str[:200]}")
                    return "expired"
                # Проверяем ADTS sync word (AAC) или MP3 sync / ID3
                header_ok = False
                if len(chunk) >= 2 and chunk[0] == 0xFF and (chunk[1] & 0xE0) == 0xE0:
                    header_ok = True  # ADTS AAC
                elif len(chunk) >= 4 and chunk[0] in (0x49, 0x50):  # ID3 "ID3" or "MP+"
                    header_ok = True
                elif len(chunk) >= 4 and chunk[0] == 0xFF and (chunk[1] & 0xE0) == 0xE0:
                    header_ok = True  # MP3 sync (0xFF + 0xE0 or higher)
                elif len(chunk) >= 2 and chunk[0] in (0x00, 0x01, 0x02) and chunk[1] in (0x00, 0x50, 0x66, 0x6E):
                    header_ok = True  # various valid MPEG audio
                if not header_ok:
                    stderr_str = await _read_stderr(process)
                    print(f"⚠️ [ffmpeg] first chunk has no audio sync word (bytes={chunk[:8].hex()}) → broken")
                    print(f"   stderr: {stderr_str[:200]}")
                    return "expired"

                print(f"⏱  [ffmpeg] +{((_t.perf_counter()-_t0)*1000):.0f}ms FIRST CHUNK "
                      f"→ {len(bc.listeners)} listeners ({len(chunk)}b, header ok)")

            await bc.broadcast_chunk(chunk)
            bytes_sent += len(chunk)
            _chunk_count += 1
            if _chunk_count % 16 == 0:
                await asyncio.sleep(0)

        if bc.skip_event.is_set():
            return "skipped"

        if process.returncode is None:
            try:
                process.kill()
                await asyncio.wait_for(process.wait(), timeout=3.0)
            except Exception:
                pass

        rc = process.returncode

        if bytes_sent < _MIN_BYTES:
            stderr_str = await _read_stderr(process)
            if stderr_str:
                print(f"⚠️ [ffmpeg] stderr (rc={rc}): {stderr_str[:400]}")
            print(f"🔄 [ffmpeg] only {bytes_sent}b sent (rc={rc}) → expired/failed")
            return "expired"

        stderr_str = await _read_stderr(process)
        if stderr_str:
            print(f"⚠️ [ffmpeg] stderr (rc={rc}): {stderr_str[:400]}")

        if any(code in stderr_str for code in
               ['401', '403', '404', '410', 'Forbidden', 'Unauthorized', 'Server returned']):
            print(f"🔄 [ffmpeg] URL expired (rc={rc})")
            return "expired"

        return True

    except asyncio.CancelledError:
        return False
    except Exception as e:
        import traceback
        print(f"❌ stream_ffmpeg error: {e!r}")
        traceback.print_exc()
        return "expired" if bytes_sent < _MIN_BYTES else True
    finally:
        if process and process.returncode is None:
            try:
                process.kill()
                await process.wait()
            except Exception:
                pass


async def _read_stderr(process) -> str:
    try:
        data = await asyncio.wait_for(process.stderr.read(), timeout=2.0)
        return data.decode(errors='replace') if data else ''
    except Exception:
        return ''


# ── Audio validation ────────────────────────────────────────────────────────────

def validate_audio_file(path_or_url: str, timeout: int = 10) -> dict:
    """
    Проверить аудиофайл ffmpeg'ом: длительность, кодеки, битрейт.
    Возвращает dict с полями:
      ok          — bool, файл играбельный
      duration    — float секунд (None если не определить)
      codec       — str ('aac', 'mp3', 'ogg', 'flac', 'unknown')
      bitrate     — int kbps
      error       — str если не ok
      is_broken   — True если файл повреждён/пустой
    """
    import subprocess, re, os

    if path_or_url.startswith(('http://', 'https://')):
        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-timeout', str(timeout * 1_000_000),
            '-i', path_or_url,
            '-t', '0.1',  # только начало, не качать весь файл
            '-f', 'null', '-',
        ]
    else:
        if not os.path.isfile(path_or_url):
            return {"ok": False, "error": "file_not_found", "is_broken": True}
        size = os.path.getsize(path_or_url)
        if size < 4096:
            return {"ok": False, "error": f"file_too_small({size}b)", "is_broken": True}
        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-i', path_or_url,
            '-t', '0.1',
            '-f', 'null', '-',
        ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 2)
        stderr = result.stderr or ""

        # Проверяем что ffmpeg не выдал ошибок разбора
        broken_patterns = [
            'Invalid data found', 'moov atom not found', 'broken file',
            'end of file', 'file is empty', 'header not found',
            'AAC bitstream error', 'corrupted', 'Invalid argument',
            'Server returned 404', 'Server returned 403',
        ]
        for p in broken_patterns:
            if p.lower() in stderr.lower():
                return {"ok": False, "error": p, "is_broken": True}

        # Получаем метаданные (duration, codec, bitrate) из ffprobe
        probe_cmd = [
            'ffprobe', '-hide_banner', '-loglevel', 'error',
            '-show_streams', '-show_format', '-of', 'json',
            path_or_url if not path_or_url.startswith('http') else path_or_url,
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=timeout + 2)
        if probe_result.returncode != 0:
            return {"ok": False, "error": probe_result.stderr[:200] or "ffprobe_failed", "is_broken": True}

        import json as _json
        try:
            info = _json.loads(probe_result.stdout)
        except Exception:
            return {"ok": True, "duration": None, "codec": "unknown", "bitrate": None}

        streams = info.get("streams", [])
        audio_stream = None
        for s in streams:
            if s.get("codec_type") == "audio":
                audio_stream = s
                break

        if not audio_stream:
            return {"ok": False, "error": "no_audio_stream", "is_broken": True}

        duration_str = info.get("format", {}).get("duration", "0")
        duration = float(duration_str) if duration_str else 0.0

        codec = audio_stream.get("codec_name", "unknown")
        bitrate_str = audio_stream.get("bit_rate") or info.get("format", {}).get("bit_rate", "0")
        try:
            bitrate = int(bitrate_str) // 1000
        except Exception:
            bitrate = 0

        return {
            "ok": True,
            "duration": duration if duration > 0 else None,
            "codec": codec,
            "bitrate": bitrate,
            "is_broken": False,
        }

    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "is_broken": False}
    except Exception as e:
        return {"ok": False, "error": str(e), "is_broken": True}


async def validate_audio_async(path_or_url: str, timeout: int = 10) -> dict:
    """Асинхронная версия validate_audio_file."""
    import asyncio as _asyncio
    def _sync():
        return validate_audio_file(path_or_url, timeout)
    return await _asyncio.to_thread(_sync)
