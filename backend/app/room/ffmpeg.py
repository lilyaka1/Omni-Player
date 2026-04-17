"""
ffmpeg streaming — транскодирование аудио и передача чанков слушателям.
"""
import asyncio
import time as _t
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.room.room_state import RoomState as RoomBroadcast

# Минимум байт для «нормального» трека (меньше — URL протух)
_MIN_BYTES = 100 * 1024

# Размер чанка: 8KB ≈ 0.5с при 128kbps
# Больше — ffmpeg без -re выгружает всё мгновенно и блокирует event loop
_CHUNK_SIZE = 8 * 1024

_FFMPEG_CMD_BASE = [
    'ffmpeg', '-hide_banner', '-loglevel', 'warning',
    '-re',  # ОБЯЗАТЕЛЕН: без него ffmpeg выгружает весь файл мгновенно,
            # tight loop блокирует asyncio → сервер не отвечает на HTTP запросы
    '-headers', 'Referer: https://soundcloud.com/\r\nOrigin: https://soundcloud.com\r\n',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
]


async def stream_ffmpeg(bc: "RoomBroadcast", stream_url: str):
    """
    Запускает ffmpeg, транскодирует в MP3, льёт чанки в broadcast.

    Возвращает:
      True      — трек дошёл до конца естественно
      False     — bc.running стал False (остановили снаружи)
      "skipped" — admin нажал skip
      "expired" — URL протух (401/403 или < 100KB)
    """
    bc._ring_buffer.clear()
    _t0 = _t.perf_counter()

    cmd = _FFMPEG_CMD_BASE + [
        '-i', stream_url,
        '-vn',
        '-map_metadata', '-1',
        '-c:a', 'copy',
        '-f', 'mp3',
        '-',
    ]

    process = None
    bytes_sent = 0

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        print(f"⏱  [ffmpeg] +{((_t.perf_counter()-_t0)*1000):.0f}ms process started (pid={process.pid})")

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
                print(f"⏱  [ffmpeg] +{((_t.perf_counter()-_t0)*1000):.0f}ms FIRST CHUNK "
                      f"→ {len(bc.listeners)} listeners ({len(chunk)}b)")

            await bc.broadcast_chunk(chunk)
            bytes_sent += len(chunk)
            _chunk_count += 1
            # Явно отдаём управление event loop каждые 16 чанков
            # чтобы HTTP-запросы не голодали
            if _chunk_count % 16 == 0:
                await asyncio.sleep(0)

        # Skip event — admin переключил трек
        if bc.skip_event.is_set():
            return "skipped"

        # Завершаем процесс
        if process.returncode is None:
            try:
                process.kill()
                await asyncio.wait_for(process.wait(), timeout=3.0)
            except Exception:
                pass

        rc = process.returncode

        # Слишком мало байт → URL протух или ошибка
        if bytes_sent < _MIN_BYTES:
            stderr_str = await _read_stderr(process)
            if stderr_str:
                print(f"⚠️ [ffmpeg] stderr (rc={rc}): {stderr_str[:400]}")
            print(f"🔄 [ffmpeg] only {bytes_sent}b sent (rc={rc}) → expired/failed")
            return "expired"

        stderr_str = await _read_stderr(process)
        if stderr_str:
            print(f"⚠️ [ffmpeg] stderr (rc={rc}): {stderr_str[:400]}")

        if any(code in stderr_str for code in ['401', '403', '404', '410', 'Forbidden', 'Unauthorized', 'Server returned']):
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
