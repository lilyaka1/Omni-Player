"""
Track service for music player
Handles track metadata extraction and library management
"""
import asyncio
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional, List
from sqlalchemy.orm import Session
import yt_dlp

import hashlib
import mimetypes

from app.database.models import Track, UserTrack, Playlist, PlaylistTrack, SourceEnum, MediaAsset
from app.core.storage import get_storage
from app.core.config import get_settings
from app.services.metadata import split_artist_title

settings = get_settings()


def parse_url(url: str) -> tuple[SourceEnum, str]:
    """Извлечь source и track_id из URL"""
    if 'soundcloud.com' in url:
        # Простой парсинг, можно улучшить
        parts = url.split('/')
        track_id = parts[-1] if parts else url
        return SourceEnum.SOUNDCLOUD, track_id
    elif 'youtube.com' in url or 'youtu.be' in url:
        # Простой парсинг
        if 'v=' in url:
            track_id = url.split('v=')[1].split('&')[0]
        else:
            track_id = url.split('/')[-1]
        return SourceEnum.YOUTUBE, track_id
    else:
        return SourceEnum.SOUNDCLOUD, url  # fallback


class TrackService:
    """Сервис для работы с метаданными треков"""
    
    def __init__(self, db: Session):
        self.db = db
    
    async def add_track_to_library(
        self,
        user_id: int,
        track_url: str,
        target_downloads_dir: Optional[str] = None,
    ) -> Track:
        """
        Добавить трек в библиотеку пользователя
        Если трек новый - извлечь метаданные через yt-dlp
        """
        source, track_id = parse_url(track_url)
        
        # Проверить: трек уже есть?
        existing = self.db.query(Track).filter(
            Track.source == source,
            Track.source_track_id == track_id
        ).first()
        
        if existing:
            # Обновить stream_url если протух
            if existing.stream_url_expires_at < datetime.utcnow():
                existing = await self.refresh_stream_url(existing)
        else:
            # Создать Track из метаданных без скачивания (download worker будет работать в фоне)
            existing = await self.create_track_from_url(
                track_url,
                download=True,
                target_downloads_dir=target_downloads_dir,
            )

            # background ingestion will be handled by the centralized ingest worker
        
        # Добавить в библиотеку юзера (если еще нет)
        user_track = self.db.query(UserTrack).filter(
            UserTrack.user_id == user_id,
            UserTrack.track_id == existing.id
        ).first()
        
        if not user_track:
            user_track = UserTrack(user_id=user_id, track_id=existing.id)
            self.db.add(user_track)
            self.db.commit()
        
        return existing
    
    async def create_track_from_url(
        self,
        url: str,
        download: bool = True,
        target_downloads_dir: Optional[str] = None,
    ) -> Track:
        """Создать Track из URL (извлечь метаданные и опционально скачать файл)"""
        info = await self._extract_metadata(url)
        
        source, track_id = parse_url(url)
        
        # Скачать аудиофайл если download=True
        local_file_path = None
        media_asset_id = None
        canonical_key = None
        if download:
            dl_result = await self._download_audio(
                url,
                info,
                target_downloads_dir=target_downloads_dir,
            )
            if isinstance(dl_result, dict):
                local_file_path = dl_result.get('local_path')
                media_asset_id = dl_result.get('media_asset_id')
                canonical_key = dl_result.get('canonical')
            else:
                local_file_path = dl_result
        
        title, artist = split_artist_title(
            info.get('title', 'Unknown'),
            info.get('uploader') or info.get('artist') or info.get('channel'),
        )

        track = Track(
            source=source,
            source_track_id=track_id,
            source_page_url=url,
            title=title,
            artist=artist,
            duration=info.get('duration'),
            stream_url=info.get('url', ''),
            stream_url_expires_at=datetime.utcnow() + timedelta(hours=24),
            thumbnail_url=info.get('thumbnail'),
            bitrate=info.get('abr', 128),
            codec=info.get('acodec', 'mp3'),
            album=info.get('album'),
            genre=info.get('genre'),
            year=info.get('release_year'),
            local_file_path=local_file_path,
            canonical_key=canonical_key,
            media_asset_id=media_asset_id,
            processing_status=('ready' if local_file_path else ('ready' if info.get('url') else 'processing')),
            processing_progress=(100 if local_file_path else (100 if info.get('url') else 0)),
        )
        self.db.add(track)
        self.db.commit()
        self.db.refresh(track)
        # If we downloaded a local file, do NOT set `track.stream_url` here.
        # Instead finalize ingestion so a TrackAsset is created and playability
        # is determined by TrackAsset.status == 'ready'.
        if local_file_path:
            try:
                from app.services.ingest_state import complete_success
                complete_success(track.id, local_file_path, None, None)
            except Exception:
                # If ingestion finalization fails, leave the track record
                # without an internal playable URL; ingestion worker can retry.
                pass
        return track
    
    async def refresh_stream_url(self, track: Track) -> Track:
        """Обновить stream_url при протухании"""
        info = await self._extract_metadata(track.source_page_url)
        track.stream_url = info.get('url', track.stream_url)
        track.stream_url_expires_at = datetime.utcnow() + timedelta(hours=24)
        self.db.commit()
        self.db.refresh(track)
        return track
    
    async def _extract_metadata(self, url: str) -> Dict:
        """Получить metadata через yt-dlp"""
        def _sync_extract():
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': False,
                'format': 'bestaudio/best',
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                try:
                    return ydl.extract_info(url, download=False)
                except Exception as e:
                    print(f"Error extracting metadata: {e}")
                    return {}
        
        return await asyncio.to_thread(_sync_extract)
    
    async def _download_audio(
        self,
        url: str,
        info: Dict,
        target_downloads_dir: Optional[str] = None,
    ) -> Optional[str]:
        """Скачать аудиофайл локально"""
        def _sync_download():
            try:
                # Создать папку downloads если не существует
                downloads_dir = Path(target_downloads_dir or settings.DOWNLOADS_DIR)
                downloads_dir.mkdir(parents=True, exist_ok=True)
                
                # Безопасное имя файла
                title = info.get('title', 'unknown').replace('/', '_').replace('\\', '_')
                filename = f"{title}.%(ext)s"
                output_path = str(downloads_dir / filename)
                
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'outtmpl': output_path,
                    'quiet': True,
                    'no_warnings': True,
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                }
                
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                    
                # Найти скачанный файл
                final_path = str(downloads_dir / f"{title}.mp3")
                if not os.path.exists(final_path):
                    return None

                # Вычислить canonical_key (sha256)
                sha256 = hashlib.sha256()
                with open(final_path, 'rb') as fh:
                    for chunk in iter(lambda: fh.read(8192), b""):
                        sha256.update(chunk)
                canonical = sha256.hexdigest()

                # Сохранить/записать в Storage (LocalStorage копирует в DOWNLOADS_DIR по умолчанию)
                storage = get_storage()
                # Use filename from final_path
                dest_name = os.path.basename(final_path)
                stored_path = storage.save_file(final_path, dest_name=dest_name)

                # Create or reuse MediaAsset in DB (we will do DB-level operations outside thread)
                return {
                    'final_path': stored_path,
                    'canonical': canonical,
                }
                    
            except Exception as e:
                print(f"Error downloading audio: {e}")
                return None
        result = await asyncio.to_thread(_sync_download)
        if not result:
            return None

        # DB operations: create or reuse MediaAsset
        final_path = result['final_path']
        canonical = result['canonical']

        # Check existing asset
        existing_asset = self.db.query(MediaAsset).filter(
            MediaAsset.canonical_key == canonical
        ).first()

        if existing_asset:
            media_asset = existing_asset
        else:
            size = os.path.getsize(final_path) if os.path.exists(final_path) else None
            mime = mimetypes.guess_type(final_path)[0] if final_path else None
            media_asset = MediaAsset(
                storage_path=str(final_path),
                size=size,
                mime=mime,
                canonical_key=canonical,
            )
            self.db.add(media_asset)
            self.db.commit()
            self.db.refresh(media_asset)

        return {'local_path': final_path, 'media_asset_id': media_asset.id, 'canonical': canonical}
    
    def get_user_library(self, user_id: int, skip: int = 0, limit: int = 100) -> List[Dict]:
        """Получить библиотеку пользователя"""
        results = (
            self.db.query(Track, UserTrack)
            .join(UserTrack, Track.id == UserTrack.track_id)
            .filter(UserTrack.user_id == user_id)
            .order_by(UserTrack.added_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        
        return [
            {
                "track": {
                    "id": track.id,
                    "title": track.title,
                    "artist": track.artist,
                    "duration": track.duration,
                    "stream_url": track.stream_url,
                    "thumbnail_url": track.thumbnail_url,
                    "source": track.source.value if hasattr(track.source, "value") else str(track.source),
                    "local_file_path": track.local_file_path,
                    "processing_status": track.processing_status,
                    "processing_progress": track.processing_progress,
                },
                "user_data": {
                    "added_at": user_track.added_at.isoformat(),
                    "is_favorite": user_track.is_favorite,
                    "play_count": user_track.play_count,
                    "last_played_at": user_track.last_played_at.isoformat() if user_track.last_played_at else None,
                }
            }
            for track, user_track in results
        ]
    
    def increment_play_count(self, user_id: int, track_id: int):
        """Увеличить счётчик воспроизведений"""
        # Персональный счётчик
        user_track = self.db.query(UserTrack).filter(
            UserTrack.user_id == user_id,
            UserTrack.track_id == track_id
        ).first()
        
        if user_track:
            user_track.play_count += 1
            user_track.last_played_at = datetime.utcnow()
        
        # Глобальный счётчик
        track = self.db.query(Track).filter(Track.id == track_id).first()
        if track:
            track.total_plays += 1
            # Обновить unique_listeners
            unique_count = self.db.query(UserTrack).filter(
                UserTrack.track_id == track_id
            ).count()
            track.unique_listeners = unique_count
        
        self.db.commit()
    
    async def import_playlist(
        self,
        playlist_url: str,
        user_id: int,
        create_playlist: bool = True,
        is_album: bool = False
    ) -> Dict:
        """
        Импортировать плейлист (извлечь метаданные всех треков)
        Клиент затем сам скачает аудио
        """
        # Извлечь список треков
        def _extract_playlist():
            ydl_opts = {
                'quiet': True,
                'extract_flat': 'in_playlist',
                'skip_download': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(playlist_url, download=False)
        
        playlist_info = await asyncio.to_thread(_extract_playlist)
        
        if not playlist_info or 'entries' not in playlist_info:
            raise ValueError("Invalid playlist URL or no tracks found")
        
        # Создать Playlist в БД
        playlist_id = None
        if create_playlist:
            source, source_id = parse_url(playlist_url)
            playlist = Playlist(
                owner_id=user_id,
                name=playlist_info.get('title', 'Imported Playlist'),
                description=playlist_info.get('description', ''),
                thumbnail=playlist_info.get('thumbnail'),
                is_album=is_album,
                source=source,
                source_playlist_id=playlist_info.get('id')
            )
            self.db.add(playlist)
            self.db.flush()
            playlist_id = playlist.id
        
        tracks = []
        existing_count = 0
        new_count = 0
        
        for order, entry in enumerate(playlist_info['entries']):
            if not entry:
                continue
            
            track_url = entry.get('webpage_url') or entry.get('url')
            if not track_url:
                continue
            
            try:
                # Добавить трек в библиотеку
                track = await self.add_track_to_library(user_id, track_url)
                
                # Добавить в плейлист
                if playlist_id:
                    playlist_track = PlaylistTrack(
                        playlist_id=playlist_id,
                        track_id=track.id,
                        order=order
                    )
                    self.db.add(playlist_track)
                
                tracks.append({
                    "id": track.id,
                    "title": track.title,
                    "artist": track.artist,
                    "stream_url": track.stream_url,
                    "thumbnail_url": track.thumbnail_url,
                    "duration": track.duration
                })
                
                new_count += 1
            except Exception as e:
                print(f"Error importing track {track_url}: {e}")
                continue
        
        self.db.commit()
        
        return {
            "playlist_id": playlist_id,
            "tracks": tracks,
            "total_tracks": len(playlist_info['entries']),
            "existing_tracks": existing_count,
            "new_tracks": new_count
        }
