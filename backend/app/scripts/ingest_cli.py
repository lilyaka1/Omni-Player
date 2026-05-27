#!/usr/bin/env python3
"""CLI tool to run ingestion worker loops or single tasks for debugging.

Usage examples:
  python -m app.scripts.ingest_cli --once
  python -m app.scripts.ingest_cli --loop --interval 5
  python -m app.scripts.ingest_cli --track 123
"""
import argparse
import asyncio
from datetime import datetime, timedelta
from app.database.session import SessionLocal
from app.database.models import Track
from app.services.ingest_state import start_processing, complete_success, mark_failure, recover_stuck_tasks
from app.services.track_service import TrackService


async def process_track_id(tid: int):
    # Try to acquire lock via state machine
    locked = start_processing(tid)
    if not locked:
        print(f"[cli] Could not lock track {tid}, skipping")
        return

    svc_db = SessionLocal()
    try:
        svc = TrackService(svc_db)
        t = svc_db.query(Track).filter(Track.id == tid).first()
        if not t:
            print(f"[cli] Track {tid} disappeared")
            return

        print(f"[cli] Processing track {tid} ({t.title})")
        try:
            info = await svc._extract_metadata(t.source_page_url)
        except Exception as e:
            print(f"[cli] Metadata extraction failed for {tid}: {e}")
            info = {}

        dl_res = await svc._download_audio(t.source_page_url, info or {}, None)
        if not dl_res:
            print(f"[cli] Download failed for {tid}")
            mark_failure(tid)
            return

        local_path = dl_res.get('local_path') if isinstance(dl_res, dict) else dl_res
        media_asset_id = dl_res.get('media_asset_id') if isinstance(dl_res, dict) else None
        canonical = dl_res.get('canonical') if isinstance(dl_res, dict) else None

        complete_success(tid, local_path, media_asset_id, canonical)
        print(f"[cli] Track {tid} -> ready ({local_path})")
    except Exception as e:
        print(f"[cli] Unexpected error processing {tid}: {e}")
        try:
            mark_failure(tid)
        except Exception:
            pass
    finally:
        svc_db.close()


async def run_once():
    db = SessionLocal()
    try:
        # Recovery first
        unlocked = recover_stuck_tasks()
        if unlocked:
            print(f"[cli] Recovered stuck tasks: {unlocked}")

        pending = db.query(Track).filter(Track.processing_status == 'processing', Track.ingest_locked == False).order_by(Track.created_at.asc()).limit(10).all()
        ids = [p.id for p in pending]
        if not ids:
            print('[cli] No pending tasks')
            return
        for tid in ids:
            await process_track_id(tid)
    finally:
        db.close()


async def run_loop(interval: int):
    print(f"[cli] Starting loop with interval={interval}s (Ctrl-C to stop)")
    try:
        while True:
            await run_once()
            await asyncio.sleep(interval)
    except KeyboardInterrupt:
        print('\n[cli] Loop stopped by user')


def main():
    parser = argparse.ArgumentParser(description='Ingest worker CLI runner (debug)')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--once', action='store_true', help='Run one worker iteration')
    group.add_argument('--loop', action='store_true', help='Run worker in a loop')
    group.add_argument('--track', type=int, help='Process single track id')
    parser.add_argument('--interval', type=int, default=5, help='Loop interval seconds')
    args = parser.parse_args()

    if args.track:
        asyncio.run(process_track_id(args.track))
    elif args.once:
        asyncio.run(run_once())
    elif args.loop:
        asyncio.run(run_loop(args.interval))


if __name__ == '__main__':
    main()
