from datetime import datetime, timedelta
from typing import Optional, List
from app.database.session import SessionLocal
from app.database.models import Track, TrackAsset
from sqlalchemy import update
import json
import asyncio
from app.database.models import RoomTrack
from app.websocket.manager import manager
from app.playback.controller import update_queue_state

LOCK_TIMEOUT = timedelta(minutes=10)
MAX_ATTEMPTS = 3


def start_processing(track_id: int) -> Optional[Track]:
    """Atomically acquire lock and mark start of processing. Returns Track if locked, else None."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        # conditional update: only acquire if not locked and status is processing
        res = db.query(Track).filter(Track.id == track_id, Track.ingest_locked == False, Track.processing_status == 'processing').update({
            Track.ingest_locked: True,
            Track.ingest_attempts: Track.ingest_attempts + 1,
            Track.ingest_started_at: now,
            Track.processing_progress: 0,
        }, synchronize_session=False)
        db.commit()
        if not res:
            return None
        t = db.query(Track).filter(Track.id == track_id).first()
        return t
    finally:
        db.close()


def complete_success(track_id: int, local_path: str, media_asset_id: Optional[int], canonical: Optional[str]):
    db = SessionLocal()
    try:
        t = db.query(Track).filter(Track.id == track_id).first()
        if not t:
            return
        # Update track metadata and mark processing as ready
        t.local_file_path = local_path
        t.media_asset_id = media_asset_id
        t.canonical_key = canonical
        # Do NOT mutate Track.stream_url here - playback transport is asset-based.
        t.processing_status = 'ready'
        t.processing_progress = 100
        t.ingest_locked = False
        t.ingest_started_at = None
        db.commit()

        # Create TrackAsset record for the downloaded file.
        try:
            asset = TrackAsset(
                track_id=t.id,
                source_type='local',
                local_path=local_path,
                mime=None,
                duration=t.duration,
                status='ready'
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)

            # Broadcast a global track_ready event (clients/rooms should reconcile)
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    for room_id in list(manager.active_connections.keys()):
                        loop.create_task(manager.broadcast_event(room_id, 'track_ready', {
                            'track_id': t.id,
                            'asset_id': asset.id,
                            'local_path': asset.local_path,
                        }))
                else:
                    for room_id in list(manager.active_connections.keys()):
                        asyncio.run(manager.broadcast_event(room_id, 'track_ready', {
                            'track_id': t.id,
                            'asset_id': asset.id,
                            'local_path': asset.local_path,
                        }))
            except Exception:
                pass
            # Update any RoomTrack queue_state entries that referenced this track
            try:
                room_tracks = db.query(RoomTrack).filter(
                    RoomTrack.source == t.source,
                    RoomTrack.source_track_id == t.source_track_id,
                ).all()
                for rt in room_tracks:
                    try:
                        update_queue_state(rt.id, 'ready')
                    except Exception:
                        pass
                if room_tracks:
                    # Notify rooms so playback loop can reconcile immediately
                    try:
                        loop = asyncio.get_event_loop()
                        for rt in room_tracks:
                            if loop.is_running():
                                loop.create_task(manager.broadcast_event(rt.room_id, 'queue_item_updated', {"track_id": rt.id, "queue_state": 'ready'}))
                            else:
                                asyncio.run(manager.broadcast_event(rt.room_id, 'queue_item_updated', {"track_id": rt.id, "queue_state": 'ready'}))
                    except Exception:
                        pass
            except Exception:
                pass
        except Exception:
            # non-fatal: if asset creation/notification fails, continue
            pass
    finally:
        db.close()


def mark_failure(track_id: int):
    db = SessionLocal()
    try:
        t = db.query(Track).filter(Track.id == track_id).first()
        if not t:
            return
        attempts = t.ingest_attempts or 0
        if attempts >= MAX_ATTEMPTS:
            t.processing_status = 'failed'
            t.processing_progress = None
        else:
            t.processing_status = 'processing'
            t.processing_progress = 0
        t.ingest_locked = False
        t.ingest_started_at = None
        db.commit()
    finally:
        db.close()


def recover_stuck_tasks(db=None) -> List[int]:
    """Unlock tasks stuck longer than LOCK_TIMEOUT. Returns list of unlocked ids."""
    _owns_db = db is None
    if _owns_db:
        db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - LOCK_TIMEOUT
        stuck = db.query(Track).filter(Track.ingest_locked == True, Track.ingest_started_at != None, Track.ingest_started_at < cutoff).all()
        ids = [t.id for t in stuck]
        if ids:
            db.query(Track).filter(Track.id.in_(ids)).update({
                Track.ingest_locked: False,
                Track.ingest_started_at: None,
                Track.processing_status: 'processing',
                Track.processing_progress: 0,
            }, synchronize_session=False)
            db.commit()
        return ids
    finally:
        db.close()
