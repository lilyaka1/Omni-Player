from enum import Enum
from typing import Dict, Optional


class AvailabilityStatus(str, Enum):
    FULL = 'FULL'
    PREVIEW_ONLY = 'PREVIEW_ONLY'
    RESTRICTED = 'RESTRICTED'
    UNKNOWN = 'UNKNOWN'


def _has_full_progressive_format(formats: list) -> bool:
    if not formats:
        return False
    for f in formats:
        fmt_id = str(f.get('format_id', '')).lower()
        url = f.get('url') or ''
        ext = (f.get('ext') or '').lower()
        # direct HTTP progressive formats usually have mp3/aac/m4a/opus and not hls/dash
        if 'm3u8' in fmt_id or 'hls' in fmt_id or 'dash' in fmt_id:
            continue
        if ext in ('mp3', 'aac', 'm4a', 'opus') and url:
            return True
    return False


def classify_soundcloud_metadata(metadata: Optional[Dict]) -> AvailabilityStatus:
    """
    Lightweight classifier for SoundCloud track metadata (yt-dlp info dict).

    Heuristics:
    - If duration is very short (<= 45s) -> PREVIEW_ONLY
    - If monetization_model / publisher hints present (premium/go+) -> RESTRICTED
    - If there is a direct progressive audio format -> FULL
    - If only HLS/M3U8 manifests are present -> RESTRICTED
    - Otherwise UNKNOWN
    """
    if not metadata or not isinstance(metadata, dict):
        return AvailabilityStatus.UNKNOWN

    # Duration check: many previews are ~30s
    duration = metadata.get('duration') or 0
    try:
        if duration and float(duration) > 0 and float(duration) <= 45:
            return AvailabilityStatus.PREVIEW_ONLY
    except Exception:
        pass

    # Monetization / premium indicators
    monet = metadata.get('monetization_model') or metadata.get('license') or ''
    if monet:
        monet = str(monet).lower()
        if 'paid' in monet or 'premium' in monet or 'go' in monet or 'plus' in monet:
            return AvailabilityStatus.RESTRICTED

    # Publisher metadata hints
    publisher = metadata.get('publisher_metadata') or {}
    if isinstance(publisher, dict):
        if publisher.get('urn') or publisher.get('release_title') or publisher.get('contains_music') is True:
            # presence of publisher metadata may indicate release gating
            # but don't assume restricted — continue checks
            pass

    # Formats check
    formats = metadata.get('formats') or []
    if _has_full_progressive_format(formats):
        return AvailabilityStatus.FULL

    # If formats exist but only HLS/DASH -> likely restricted/stream-only
    if formats:
        only_stream_manifests = True
        for f in formats:
            fmt_id = str(f.get('format_id', '')).lower()
            if not ('m3u8' in fmt_id or 'hls' in fmt_id or 'dash' in fmt_id):
                only_stream_manifests = False
                break
        if only_stream_manifests:
            return AvailabilityStatus.RESTRICTED

    # Additional flags
    if metadata.get('is_unplayable') or metadata.get('license') == 'all-rights-reserved':
        return AvailabilityStatus.RESTRICTED

    return AvailabilityStatus.UNKNOWN
