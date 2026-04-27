"""
HLS (HTTP Live Streaming) транскодер для Omni Player.
Конвертирует MP3 стрим в HLS формат с сегментацией.
"""
import asyncio
import os
import tempfile
import shutil
from pathlib import Path
from typing import Optional, Dict
import time

class HLSTranscoder:
    """
    HLS транскодер - конвертирует аудио стрим в HLS формат.
    Создает .m3u8 плейлист и .ts сегменты.
    """
    
    def __init__(self, room_id: int, segment_duration: int = 6):
        self.room_id = room_id
        self.segment_duration = segment_duration  # Длительность сегмента в секундах
        self.output_dir: Optional[Path] = None
        self.process: Optional[asyncio.subprocess.Process] = None
        self.running = False
        self._segment_index = 0
        self._playlist_path: Optional[Path] = None
        
    async def start(self, input_url: str) -> str:
        """
        Запускает HLS транскодирование.
        Возвращает путь к .m3u8 плейлисту.
        """
        if self.running:
            raise RuntimeError(f"HLS transcoder for room {self.room_id} already running")
        
        # Создаем временную директорию для HLS файлов
        self.output_dir = Path(tempfile.mkdtemp(prefix=f"hls_room_{self.room_id}_"))
        self._playlist_path = self.output_dir / "playlist.m3u8"
        
        print(f"🎬 [HLS] Room {self.room_id}: Starting HLS transcoding")
        print(f"📁 [HLS] Output directory: {self.output_dir}")
        
        # FFmpeg команда для HLS транскодирования
        # -c:a copy - копируем аудио без перекодирования (быстрее)
        # -f hls - HLS формат
        # -hls_time - длительность сегмента
        # -hls_list_size 10 - держим последние 10 сегментов в плейлисте
        # -hls_flags delete_segments - удаляем старые сегменты
        # -hls_segment_filename - шаблон имени сегментов
        cmd = [
            'ffmpeg',
            '-i', input_url,
            '-c:a', 'aac',  # Конвертируем в AAC для лучшей совместимости
            '-b:a', '128k',  # Битрейт 128kbps
            '-f', 'hls',
            '-hls_time', str(self.segment_duration),
            '-hls_list_size', '10',  # Держим последние 10 сегментов
            '-hls_flags', 'delete_segments+append_list',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', str(self.output_dir / 'segment_%03d.ts'),
            '-loglevel', 'warning',
            str(self._playlist_path)
        ]
        
        print(f"🚀 [HLS] Starting ffmpeg: {' '.join(cmd)}")
        
        try:
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            self.running = True
            
            # Запускаем мониторинг процесса в фоне
            asyncio.create_task(self._monitor_process())
            
            # Ждем создания первого сегмента
            await self._wait_for_playlist()
            
            print(f"✅ [HLS] Room {self.room_id}: HLS transcoding started successfully")
            return str(self._playlist_path)
            
        except Exception as e:
            print(f"❌ [HLS] Room {self.room_id}: Failed to start transcoding: {e}")
            await self.stop()
            raise
    
    async def _wait_for_playlist(self, timeout: int = 30):
        """Ждет создания плейлиста и первого сегмента."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self._playlist_path and self._playlist_path.exists():
                # Проверяем что есть хотя бы один сегмент
                segments = list(self.output_dir.glob('segment_*.ts'))
                if segments:
                    print(f"✅ [HLS] Playlist ready with {len(segments)} segment(s)")
                    return
            await asyncio.sleep(0.5)
        
        raise TimeoutError(f"HLS playlist not created within {timeout}s")
    
    async def _monitor_process(self):
        """Мониторит процесс ffmpeg и логирует ошибки."""
        if not self.process:
            return
        
        try:
            # Читаем stderr для логирования
            while self.running and self.process.returncode is None:
                line = await self.process.stderr.readline()
                if not line:
                    break
                line_str = line.decode('utf-8', errors='ignore').strip()
                if line_str and 'error' in line_str.lower():
                    print(f"⚠️ [HLS] FFmpeg: {line_str}")
            
            # Процесс завершился
            returncode = await self.process.wait()
            if returncode != 0 and self.running:
                print(f"❌ [HLS] Room {self.room_id}: FFmpeg exited with code {returncode}")
                self.running = False
                
        except Exception as e:
            print(f"❌ [HLS] Monitor error: {e}")
            self.running = False
    
    async def stop(self):
        """Останавливает HLS транскодирование и очищает файлы."""
        print(f"🛑 [HLS] Room {self.room_id}: Stopping HLS transcoding")
        self.running = False
        
        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
            except Exception as e:
                print(f"⚠️ [HLS] Error stopping process: {e}")
            finally:
                self.process = None
        
        # Очищаем временные файлы
        if self.output_dir and self.output_dir.exists():
            try:
                shutil.rmtree(self.output_dir)
                print(f"🗑️ [HLS] Cleaned up directory: {self.output_dir}")
            except Exception as e:
                print(f"⚠️ [HLS] Error cleaning up: {e}")
            finally:
                self.output_dir = None
                self._playlist_path = None
    
    def get_playlist_path(self) -> Optional[str]:
        """Возвращает путь к .m3u8 плейлисту."""
        if self._playlist_path and self._playlist_path.exists():
            return str(self._playlist_path)
        return None
    
    def is_running(self) -> bool:
        """Проверяет, запущен ли транскодер."""
        return self.running and self.process is not None

class HLSManager:
    """Менеджер HLS транскодеров для всех комнат."""
    
    def __init__(self):
        self.transcoders: Dict[int, HLSTranscoder] = {}
    
    async def start_transcoding(self, room_id: int, input_url: str, segment_duration: int = 6) -> str:
        """
        Запускает HLS транскодирование для комнаты.
        Возвращает путь к .m3u8 плейлисту.
        """
        # Останавливаем существующий транскодер если есть
        if room_id in self.transcoders:
            await self.stop_transcoding(room_id)
        
        transcoder = HLSTranscoder(room_id, segment_duration)
        self.transcoders[room_id] = transcoder
        
        try:
            playlist_path = await transcoder.start(input_url)
            return playlist_path
        except Exception as e:
            # Если не удалось запустить, удаляем из словаря
            if room_id in self.transcoders:
                del self.transcoders[room_id]
            raise
    
    async def stop_transcoding(self, room_id: int):
        """Останавливает HLS транскодирование для комнаты."""
        transcoder = self.transcoders.get(room_id)
        if transcoder:
            await transcoder.stop()
            del self.transcoders[room_id]
    
    def get_playlist_path(self, room_id: int) -> Optional[str]:
        """Получает путь к плейлисту для комнаты."""
        transcoder = self.transcoders.get(room_id)
        if transcoder:
            return transcoder.get_playlist_path()
        return None
    
    def is_transcoding(self, room_id: int) -> bool:
        """Проверяет, идет ли транскодирование для комнаты."""
        transcoder = self.transcoders.get(room_id)
        return transcoder is not None and transcoder.is_running()
    
    async def cleanup_all(self):
        """Останавливает все транскодеры."""
        print("🧹 [HLS] Cleaning up all transcoders")
        for room_id in list(self.transcoders.keys()):
            await self.stop_transcoding(room_id)

# Глобальный экземпляр менеджера
hls_manager = HLSManager()