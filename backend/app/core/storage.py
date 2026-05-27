import os
from pathlib import Path
from typing import Optional
from app.core.config import get_settings

settings = get_settings()


class Storage:
    """Abstract storage interface."""

    def save_file(self, source_path: str, dest_name: Optional[str] = None) -> str:
        raise NotImplementedError()

    def save_bytes(self, data: bytes, dest_name: str) -> str:
        raise NotImplementedError()

    def path_for(self, storage_path: str) -> str:
        raise NotImplementedError()


class LocalStorage(Storage):
    """Simple local filesystem storage that writes into DOWNLOADS_DIR."""

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = Path(base_dir or settings.DOWNLOADS_DIR)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _abs_path(self, name: str) -> Path:
        return (self.base_dir / name).resolve()

    def save_file(self, source_path: str, dest_name: Optional[str] = None) -> str:
        src = Path(source_path)
        if not src.exists():
            raise FileNotFoundError(f"source file not found: {source_path}")
        dest_name = dest_name or src.name
        dest = self._abs_path(dest_name)
        # ensure parent
        dest.parent.mkdir(parents=True, exist_ok=True)
        with src.open("rb") as rf, dest.open("wb") as wf:
            wf.write(rf.read())
        return str(dest)

    def save_bytes(self, data: bytes, dest_name: str) -> str:
        dest = self._abs_path(dest_name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as wf:
            wf.write(data)
        return str(dest)

    def path_for(self, storage_path: str) -> str:
        p = self._abs_path(storage_path)
        if not p.exists():
            raise FileNotFoundError(storage_path)
        return str(p)


# convenience singleton
_default_storage = None


def get_storage() -> Storage:
    global _default_storage
    if _default_storage is None:
        _default_storage = LocalStorage()
    return _default_storage
