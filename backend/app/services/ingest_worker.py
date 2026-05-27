import asyncio
from datetime import datetime, timedelta
from app.database.session import SessionLocal
from app.services.track_service import TrackService
from app.database.models import Track
from app.services.ingest_state import recover_stuck_tasks

POLL_INTERVAL = 5  # seconds
MAX_ATTEMPTS = 3


async def run_worker():
    """Background loop: select processing tasks, atomically lock and process them with retries and recovery."""
    while True:
        try:
            # Recovery pass: unlock stuck tasks (self-contained — owns its own db session)
            recover_stuck_tasks()

            # Select candidate ids
            db = SessionLocal()
            try:
                pending = db.query(Track).filter(
                    Track.processing_status == 'processing',
                    Track.ingest_locked == False
                ).order_by(Track.created_at.asc()).limit(5).all()
                ids = [p.id for p in pending]
            finally:
                db.close()

            if not ids:
                await asyncio.sleep(POLL_INTERVAL)
                continue

            for tid in ids:
                # Acquire lock via state machine
                from app.services.ingest_state import start_processing, complete_success, mark_failure

                t_locked = start_processing(tid)
                if not t_locked:
                    continue

                # Process the locked task
                svc_db = SessionLocal()
                try:
                    svc = TrackService(svc_db)
                    # mark progress via DB directly (safe here before heavy work)
                    t = svc_db.query(Track).filter(Track.id == tid).first()
                    if not t:
                        # nothing to do
                        continue
                    t.processing_progress = 5
                    svc_db.commit()

                    try:
                        info = await svc._extract_metadata(t.source_page_url)
                    except Exception:
                        info = {}

                    dl_res = await svc._download_audio(t.source_page_url, info or {}, None)
                    if not dl_res:
                        # failure handling via state machine
                        mark_failure(tid)
                        continue

                    # success: write fields via state machine
                    local_path = dl_res.get('local_path') if isinstance(dl_res, dict) else dl_res
                    media_asset_id = dl_res.get('media_asset_id') if isinstance(dl_res, dict) else None
                    canonical = dl_res.get('canonical') if isinstance(dl_res, dict) else None

                    complete_success(tid, local_path, media_asset_id, canonical)

                except Exception as e:
                    # On unexpected exception ensure failure is recorded via state machine
                    try:
                        mark_failure(tid)
                    except Exception:
                        pass
                    print(f"Ingest worker error processing {tid}: {e}")
                finally:
                    svc_db.close()

            # small delay to avoid hammering
            await asyncio.sleep(1)
        except Exception as e:
            print(f"Ingest worker loop error: {e}")
            await asyncio.sleep(POLL_INTERVAL)