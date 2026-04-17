"""
RingBuffer — кольцевой буфер аудиочанков для pre-buffering.
~60 секунд аудио при 128kbps и чанках по 8KB.
"""
from collections import deque

RING_BUFFER_SIZE = 120  # 120 × 8KB = 960KB ≈ 60с при 128kbps


def find_mp3_sync(data: bytes) -> int:
    """Найти первый sync word MP3 (0xFF + byte со старшими тремя битами 111).
    Возвращает смещение или -1 если не найден."""
    for i in range(len(data) - 1):
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            return i
    return -1


class RingBuffer:
    """Кольцевой буфер для хранения последних N аудиочанков."""

    def __init__(self, maxsize: int = RING_BUFFER_SIZE):
        self._buf: deque = deque(maxlen=maxsize)

    def append(self, chunk: bytes) -> None:
        self._buf.append(chunk)

    def clear(self) -> None:
        self._buf.clear()

    def snapshot(self) -> list:
        """Возвращает копию буфера как список."""
        return list(self._buf)

    def __len__(self) -> int:
        return len(self._buf)
