"""SoundCloud API integration module"""
from typing import List, Optional, Dict
import yt_dlp
import re
import httpx

class SoundCloudClient:
    """Client for SoundCloud integration - uses yt-dlp for search"""
    
    def __init__(self, client_id: Optional[str] = None):
        self.client_id = client_id
    
    async def search_tracks(self, query: str, limit: int = 10) -> List[Dict]:
        """Search for tracks on SoundCloud using yt-dlp with playlist extraction"""
        import asyncio
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'skip_download': True,
                'noplaylist': False,
                'extract_flat': 'in_playlist',
                'socket_timeout': 10,
                'http_chunk_size': 10485760,
                'youtube_include_dash_manifest': False,
            }

            def _search_sync():
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    url = f"scsearch{limit}:{query}"
                    print(f"🔍 Ищу на SoundCloud: '{query}' (лимит: {limit})")
                    try:
                        return ydl.extract_info(url, download=False)
                    except Exception as e:
                        print(f"⚠️ Первая попытка поиска не удалась: {e}")
                        return ydl.extract_info(f"scsearch:{query}", download=False)

            info = await asyncio.to_thread(_search_sync)

            if not info:
                print(f"⚠️ Нет результатов для запроса: {query}")
                return []

            entries = []
            if isinstance(info, dict):
                if 'entries' in info:
                    entries = info['entries']
                else:
                    entries = [info]
            elif isinstance(info, list):
                entries = info

            print(f"📊 yt-dlp вернул {len(entries)} записей из поиска '{query}'")

            tracks = []
            for entry in entries[:limit]:
                if not entry:
                    continue

                title = entry.get('title', 'Unknown')
                artist = entry.get('uploader', 'Unknown')
                track_id = entry.get('id', '')
                track_url = entry.get('webpage_url', '')

                if not title or not track_id or not track_url:
                    continue

                print(f"   Found track: {title} by {artist}")
                stream_url = ""

                raw_thumb = entry.get('thumbnail') or ''
                if not raw_thumb:
                    # extract_flat не заполняет thumbnail, берём из thumbnails по id
                    thumbs = entry.get('thumbnails') or []
                    for t in thumbs:
                        if t.get('id') == 't500x500':
                            raw_thumb = t['url']
                            break
                    if not raw_thumb and thumbs:
                        # берём с наибольшей шириной
                        best = max((t for t in thumbs if t.get('width')), key=lambda t: t.get('width', 0), default=None)
                        raw_thumb = best['url'] if best else ''
                    if not raw_thumb and thumbs:
                        # последний fallback — любой доступный URL
                        raw_thumb = next((t['url'] for t in thumbs if t.get('url')), '')
                if raw_thumb and 'sndcdn.com' in raw_thumb and '-t500x500' not in raw_thumb:
                    raw_thumb = re.sub(r'-(large|t\d+x\d+|mini|tiny|small|badge|t67x67|crop|original)\.(jpg|png)', '-t500x500.jpg', raw_thumb)
                    # если суффикс не найден, просто меняем расширение
                    if raw_thumb and not raw_thumb.endswith('-t500x500.jpg'):
                        raw_thumb = re.sub(r'\.(jpg|png|jpeg)$', '', raw_thumb) + '-t500x500.jpg'

                track = {
                    "id": track_id,
                    "title": title,
                    "artist": artist,
                    "duration": entry.get('duration', 0),
                    "url": stream_url,
                    "track_page_url": track_url,
                    "source": "soundcloud",
                    "thumbnail": raw_thumb,
                    "genre": entry.get('genre', ''),
                }
                tracks.append(track)

                if len(tracks) >= limit:
                    break

            print(f"✅ Возвращаю {len(tracks)} треков из API поиска")
            return tracks
        
        except Exception as e:
            print(f"❌ Ошибка поиска SoundCloud: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    async def get_track_info(self, track_url: str) -> Optional[Dict]:
        """
        Get full track information for a SoundCloud track by URL
        
        track_url: SoundCloud track URL from search results (e.g. https://soundcloud.com/artist/track)
        Returns dict with: {title, artist, url (stream), duration} or None if not found
        """
        import asyncio
        try:
            if not track_url:
                print(f"⚠️ Empty track URL/ID")
                return None

            track_url = str(track_url).strip()

            # Convert numeric ID to API URL that yt-dlp supports
            if track_url.isdigit():
                track_url = f"https://api.soundcloud.com/tracks/{track_url}"
                print(f"🔢 Numeric ID converted to: {track_url}")
            elif 'soundcloud.com' not in track_url:
                print(f"⚠️ Invalid track URL: {track_url}")
                return None

            print(f"🔎 Получаю информацию для URL: {track_url}")
            
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'skip_download': True,
                'socket_timeout': 15,
                'no_color': True,
            }

            # ВАЖНО: yt-dlp делает синхронные сетевые запросы (10-20с).
            # Запускаем в отдельном потоке, чтобы не блокировать asyncio event loop.
            def _extract_sync():
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    print(f"📍 Извлекаю информацию с yt-dlp (thread)...")
                    return ydl.extract_info(track_url, download=False)

            try:
                detailed_info = await asyncio.to_thread(_extract_sync)
            except Exception as e:
                print(f"❌ Не удалось получить информацию: {e}")
                return None

            if not detailed_info:
                print(f"⚠️ No info for URL {track_url}")
                return None

            # ИЗВЛЕКАЕМ МЕТАДАННЫЕ
            extracted_title = detailed_info.get('title', 'Unknown')
            extracted_artist = detailed_info.get('uploader', 'Unknown')

            if extracted_artist == 'Unknown':
                extracted_artist = detailed_info.get('creator', 'Unknown')
            if extracted_artist == 'Unknown':
                extracted_artist = detailed_info.get('channel', 'Unknown')

            print(f"🎵 Метаданные: {extracted_title} | {extracted_artist}")

            stream_url = ""

            if 'formats' in detailed_info and len(detailed_info['formats']) > 0:
                print(f"📊 Доступно форматов: {len(detailed_info['formats'])}")

                direct_audio_order = ['http_mp3', 'http_aac', 'http_aac_1', 'http_opus']
                for fmt in detailed_info['formats']:
                    fmt_id = fmt.get('format_id', '')
                    if any(prefix in fmt_id for prefix in direct_audio_order) and fmt.get('url'):
                        stream_url = fmt['url']
                        print(f"✅ Найден прямой HTTP формат: {fmt_id}")
                        break

                if not stream_url:
                    for fmt in detailed_info['formats']:
                        ext = fmt.get('ext', '')
                        fmt_id = fmt.get('format_id', '')
                        if ext in ['mp3', 'aac', 'opus'] and 'hls' not in fmt_id.lower() and fmt.get('url'):
                            stream_url = fmt['url']
                            print(f"✅ Найден аудиоформат: {ext}")
                            break

                if not stream_url:
                    for fmt in detailed_info['formats']:
                        fmt_url = fmt.get('url', '')
                        if fmt_url and ('.m3u8' in fmt_url or 'm3u8' in fmt.get('format_id', '')):
                            stream_url = fmt_url
                            print(f"⚠️ Используется HLS M3U8 URL")
                            break

                if not stream_url:
                    for fmt in detailed_info['formats']:
                        if fmt.get('url'):
                            stream_url = fmt['url']
                            print(f"✅ Используется первый формат")
                            break

            if not stream_url and detailed_info.get('url'):
                stream_url = detailed_info['url']
                print(f"✅ Используется общий URL")

            if stream_url:
                print(f"✅ Информация о треке получена успешно")
                raw_thumb = detailed_info.get('thumbnail') or ''
                if not raw_thumb:
                    thumbs = detailed_info.get('thumbnails') or []
                    for t in thumbs:
                        if t.get('id') == 't500x500':
                            raw_thumb = t['url']
                            break
                    if not raw_thumb and thumbs:
                        best = max((t for t in thumbs if t.get('width')), key=lambda t: t.get('width', 0), default=None)
                        raw_thumb = best['url'] if best else ''
                    if not raw_thumb and thumbs:
                        raw_thumb = next((t['url'] for t in thumbs if t.get('url')), '')
                if raw_thumb and 'sndcdn.com' in raw_thumb and '-t500x500' not in raw_thumb:
                    raw_thumb = re.sub(r'-(large|t\d+x\d+|mini|tiny|small|badge|t67x67|crop|original)\.(jpg|png)', '-t500x500.jpg', raw_thumb)
                    if raw_thumb and not raw_thumb.endswith('-t500x500.jpg'):
                        raw_thumb = re.sub(r'\.(jpg|png|jpeg)$', '', raw_thumb) + '-t500x500.jpg'
                return {
                    "title": extracted_title,
                    "artist": extracted_artist,
                    "url": stream_url,
                    "duration": detailed_info.get('duration', 0),
                    "thumbnail": raw_thumb,
                    "genre": detailed_info.get('genre', ''),
                    "description": (detailed_info.get('description') or '')[:500],
                    "like_count": detailed_info.get('like_count', 0),
                    "playback_count": detailed_info.get('view_count', 0),
                }
            else:
                print(f"❌ Не удалось извлечь URL потока")
                return None

        except Exception as e:
            print(f"❌ Ошибка получения информации трека: {e}")
            import traceback
            traceback.print_exc()
            return None
# Global client instance
soundcloud_client = SoundCloudClient()