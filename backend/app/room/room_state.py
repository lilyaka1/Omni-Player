"""
RoomState — состояние одной комнаты: broadcast, слушатели, ring buffer.
Один источник, много слушателей.
"""
import asyncio
from typing import List, Optional

from app.room.buffer import RingBuffer, find_mp3_sync


class RoomState:
    """Состояние broadcast для одной комнаты — один источник, много слушателей."""

    def __init__(self, room_id: int):
        self.room_id = room_id
        self.listeners: List[asyncio.Queue] = []
        self.task: asyncio.Task = None
        self.running = False
        self.current_track_title = ""
        self.current_track_id = None
        self._skip_event: asyncio.Event = None  # Ленивая инициализация
        self._ring_buffer: RingBuffer = RingBuffer()
        self.voice_insert_queue: List[dict] = []
        self.voice_insert_signature: Optional[str] = None

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

    def add_listener(self) -> asyncio.Queue:
        # Защита от DoS — лимит на количество слушателей
        if len(self.listeners) >= self.MAX_LISTENERS:
            raise RuntimeError(f"Room {self.room_id} reached max listeners ({self.MAX_LISTENERS})")
        
        q = asyncio.Queue(maxsize=120)  # 120 × 8KB = 960KB буфер на слушателя
        buffered = self._ring_buffer.snapshot()

        # Берём только хвост буфера — чтобы попасть в живой эфир, а не в начало трека
        tail = buffered[-self.LIVE_PREFILL_CHUNKS:] if len(buffered) > self.LIVE_PREFILL_CHUNKS else buffered

        # Ищем первую границу MP3-фрейма в хвосте
        start_chunk = len(tail)
        start_offset = 0
        for i, chunk in enumerate(tail):
            offset = find_mp3_sync(chunk)
            if offset >= 0:
                start_chunk = i
                start_offset = offset
                break

        sent = 0
        for i, chunk in enumerate(tail):
            if i < start_chunk:
                continue
            data = chunk[start_offset:] if i == start_chunk else chunk
            if not data:
                continue
            try:
                q.put_nowait(data)
                sent += 1
            except asyncio.QueueFull:
                break

        self.listeners.append(q)
        print(
            f"📻 Room {self.room_id}: listener added "
            f"(total: {len(self.listeners)}, pre-buffered={sent}/{len(buffered)} chunks)"
        )
        return q

    def remove_listener(self, q: asyncio.Queue):
        if q in self.listeners:
            self.listeners.remove(q)
        print(f"📻 Room {self.room_id}: listener removed (total: {len(self.listeners)})")

    def set_voice_insert_queue(self, inserts: List[dict], signature: Optional[str] = None):
        if signature is not None and signature == self.voice_insert_signature:
            return
        self.voice_insert_queue = [dict(item) for item in inserts]
        self.voice_insert_signature = signature

    # Backward-compatible alias used by older call sites.
    def set_voice_inserts(self, inserts: List[dict], signature: Optional[str] = None):
        self.set_voice_insert_queue(inserts, signature)

    def consume_voice_inserts(self, track_id: Optional[int]):
        if not self.voice_insert_queue:
            return []

        matched = []
        remaining = []
        for item in self.voice_insert_queue:
            play_after_track_id = item.get("play_after_track_id")
            if track_id is None:
                should_play = play_after_track_id is None
            else:
                should_play = play_after_track_id == track_id

            if should_play:
                matched.append(item)
            else:
                remaining.append(item)

        self.voice_insert_queue = remaining
        return matched

    # Backward-compatible alias used by older call sites.
    def pop_voice_inserts_for_track(self, track_id: Optional[int]):
        return self.consume_voice_inserts(track_id)

    async def broadcast_chunk(self, chunk: bytes):
        """Отправить чанк всем слушателям и сохранить в ring buffer."""
        self._ring_buffer.append(chunk)
        dead = []
        for q in self.listeners:
            try:
                q.put_nowait(chunk)
            except asyncio.QueueFull:
                pass
            except Exception:
                dead.append(q)
        for q in dead:
            self.remove_listener(q)

    async def subscribe(self):
        """
        Subscribe to broadcast stream.
        Yields audio chunks for HTTP streaming.
        """
        import time
        q = self.add_listener()
        chunks_yielded = 0
        start_time = time.time()
        
        try:
            print(f"🎧 [SUBSCRIBE] Room {self.room_id}: New subscriber, queue size={q.qsize()}")
            while True:
                chunk = await q.get()
                if chunk is None:  # End of stream signal
                    elapsed = time.time() - start_time
                    print(f"🏁 [SUBSCRIBE] Room {self.room_id}: End signal received after {elapsed:.1f}s, {chunks_yielded} chunks")
                    break
                yield chunk
                chunks_yielded += 1
                
                # Log every 200 chunks
                if chunks_yielded % 200 == 0:
                    elapsed = time.time() - start_time
                    print(f"📊 [SUBSCRIBE] Room {self.room_id}: Yielded {chunks_yielded} chunks in {elapsed:.1f}s, queue={q.qsize()}")
        except Exception as e:
            elapsed = time.time() - start_time
            print(f"❌ [SUBSCRIBE] Room {self.room_id}: Error after {elapsed:.1f}s, {chunks_yielded} chunks: {e}")
            raise
        finally:
            elapsed = time.time() - start_time
            print(f"🔌 [SUBSCRIBE] Room {self.room_id}: Unsubscribed after {elapsed:.1f}s ({chunks_yielded} chunks)")
            self.remove_listener(q)

    async def broadcast_end(self):
        """Сигнал конца потока для всех слушателей."""
        print(f"📴 Room {self.room_id}: broadcast_end() → {len(self.listeners)} listeners")
        self._ring_buffer.clear()
        for q in self.listeners:
            try:
                q.put_nowait(None)
            except Exception:
                pass


