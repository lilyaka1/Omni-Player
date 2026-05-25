"""Small metadata helpers shared by room queue and user library."""

from typing import Optional, Tuple


_UNKNOWN_ARTISTS = {"", "unknown", "неизвестно", "—", "-"}


def split_artist_title(title: Optional[str], artist: Optional[str] = None) -> Tuple[str, str]:
    """Split "Artist - Track" style titles. Always parse title for artist–track pattern."""
    clean_title = (title or "").strip()
    clean_artist = (artist or "").strip()

    # Always try to parse the title for the "Artist – Track" pattern first.
    # This handles cases where the source also provides an artist field,
    # but the title still contains both (e.g. "MAYOT – Забывай").
    for sep in (" — ", " – ", " - "):
        if sep in clean_title:
            left, right = clean_title.split(sep, 1)
            left = left.strip()
            right = right.strip()
            if left and right:
                return right, left

    # No separator found — use provided artist, or fall back
    if clean_artist.lower() not in _UNKNOWN_ARTISTS:
        return clean_title or "Без названия", clean_artist

    return clean_title or "Без названия", clean_artist or "Unknown"
