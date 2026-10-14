"""
RoomState — состояние одной комнаты: broadcast, слушатели, ring buffer.
Один источник, много слушателей.
"""
import asyncio
import time
from collections import deque
from dataclasses import dataclass
from typing import List

from app.room.buffer import RingBuffer


class RoomState:
    """Состояние одной комнаты — один источник и один общий поток чанков.

    Слушатели не получают собственные asyncio.Queue. Каждый подписчик хранит
    только курсор чтения, а сами чанки находятся в общем кольцевом буфере.
    Медленный клиент перескакивает к самому старому доступному чанку.
    """

    def __init__(self, room_id: int):
        self.room_id = room_id
        self.listeners: List[ListenerCursor] = []
        self.task: asyncio.Task = None
        self.running = False
        self.current_track_title = ""
        self.current_track_id = None
        self._skip_event: asyncio.Event = None  # Ленивая инициализация
        self._ring_buffer: RingBuffer = RingBuffer()
        self._chunks = deque(maxlen=120)
        self._next_sequence = 0
        self._stream_condition = asyncio.Condition()
        self._ended = False

    @property
    def skip_event(self) -> asyncio.Event:
        if self._skip_event is None:
            self._skip_event = asyncio.Event()
        return self._skip_event

    # Сколько чанков отдать новому слушателю при подключении.
    # 8 × 8KB ≈ 4с при 128kbps — достаточно для smooth start, но не уводит
    # слушателя далеко от живого края (радио, не VOD).
    LIVE_PREFILL_CHUNKS = 8
    
    # Максимум слушателей на комнату (защита от DoS)
    MAX_LISTENERS = 500

    def add_listener(self) -> "ListenerCursor":
        # Защита от DoS — лимит на количество слушателей
        if len(self.listeners) >= self.MAX_LISTENERS:
            raise RuntimeError(f"Room {self.room_id} reached max listeners ({self.MAX_LISTENERS})")
        
        oldest = self._chunks[0][0] if self._chunks else self._next_sequence
        cursor = ListenerCursor(
            next_sequence=max(oldest, self._next_sequence - self.LIVE_PREFILL_CHUNKS),
        )
        self.listeners.append(cursor)
        print(
            f"📻 Room {self.room_id}: listener added "
            f"(total: {len(self.listeners)}, shared-buffer={len(self._chunks)} chunks)"
        )
        return cursor

    def remove_listener(self, listener: "ListenerCursor"):
        if listener in self.listeners:
            self.listeners.remove(listener)
        print(f"📻 Room {self.room_id}: listener removed (total: {len(self.listeners)})")

    async def broadcast_chunk(self, chunk: bytes):
        """Добавить чанк в единый поток комнаты и разбудить подписчиков."""
        self._ring_buffer.append(chunk)
        async with self._stream_condition:
            self._chunks.append((self._next_sequence, chunk))
            self._next_sequence += 1
            self._ended = False
            self._stream_condition.notify_all()

    async def subscribe(self):
        """
        Subscribe to broadcast stream.
        Yields audio chunks for HTTP streaming.
        """
        cursor = self.add_listener()
        chunks_yielded = 0
        start_time = time.time()
        
        try:
            print(f"🎧 [SUBSCRIBE] Room {self.room_id}: New subscriber, shared stream")
            while True:
                async with self._stream_condition:
                    while cursor.next_sequence >= self._next_sequence and not self._ended:
                        await self._stream_condition.wait()
                    if self._ended and cursor.next_sequence >= self._next_sequence:
                        chunk = None
                    else:
                        oldest = self._chunks[0][0] if self._chunks else self._next_sequence
                        # The client fell behind the shared ring; jump to live data.
                        cursor.next_sequence = max(cursor.next_sequence, oldest)
                        if cursor.next_sequence >= self._next_sequence:
                            continue
                        index = cursor.next_sequence - oldest
                        chunk = self._chunks[index][1]
                        cursor.next_sequence += 1

                if chunk is None:
                    elapsed = time.time() - start_time
                    print(f"🏁 [SUBSCRIBE] Room {self.room_id}: End signal received after {elapsed:.1f}s, {chunks_yielded} chunks")
                    break
                yield chunk
                chunks_yielded += 1
                
                # Log every 200 chunks
                if chunks_yielded % 200 == 0:
                    elapsed = time.time() - start_time
                    print(f"📊 [SUBSCRIBE] Room {self.room_id}: Yielded {chunks_yielded} chunks in {elapsed:.1f}s")
        except Exception as e:
            elapsed = time.time() - start_time
            print(f"❌ [SUBSCRIBE] Room {self.room_id}: Error after {elapsed:.1f}s, {chunks_yielded} chunks: {e}")
            raise
        finally:
            elapsed = time.time() - start_time
            print(f"🔌 [SUBSCRIBE] Room {self.room_id}: Unsubscribed after {elapsed:.1f}s ({chunks_yielded} chunks)")
            self.remove_listener(cursor)

    async def broadcast_end(self):
        """Сигнал конца потока для всех слушателей."""
        print(f"📴 Room {self.room_id}: broadcast_end() → {len(self.listeners)} listeners")
        self._ring_buffer.clear()
        async with self._stream_condition:
            self._ended = True
            self._stream_condition.notify_all()


@dataclass
class ListenerCursor:
    """Минимальное per-connection состояние, без буфера аудиоданных."""

    next_sequence: int = 0


