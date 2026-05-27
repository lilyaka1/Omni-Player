import time
from datetime import datetime, timedelta
from app.database.session import SessionLocal, init_db
from app.database.models import Track
from app.services.ingest_state import start_processing, complete_success, mark_failure, recover_stuck_tasks


def setup_module(module):
    # ensure DB tables exist
    init_db()


def teardown_module(module):
    pass


def test_start_and_complete_cycle():
    db = SessionLocal()
    try:
        # create track in processing state
        t = Track(
            source='youtube',
            source_track_id='test123',
            source_page_url='http://example.com/test',
            title='Test',
            artist='Tester',
            duration=1.0,
            stream_url='',
            stream_url_expires_at=datetime.utcnow() + timedelta(hours=1),
            processing_status='processing',
            processing_progress=0,
            ingest_locked=False,
            ingest_attempts=0,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        tid = t.id

        # start_processing should lock and increment attempts
        locked = start_processing(tid)
        assert locked is not None
        # fetch fresh from DB to validate
        db.expire_all()
        t_locked = db.query(Track).filter(Track.id == tid).first()
        assert t_locked.ingest_locked is True
        assert t_locked.ingest_attempts >= 1

        # complete success
        complete_success(tid, '/tmp/fake.mp3', None, 'abc')
        db.expire_all()
        t2 = db.query(Track).filter(Track.id == tid).first()
        assert t2.processing_status == 'ready'
        assert t2.processing_progress == 100
        assert t2.local_file_path == '/tmp/fake.mp3'
    finally:
        # cleanup
        db.query(Track).filter(Track.source_track_id == 'test123').delete()
        db.commit()
        db.close()


def test_failure_and_retry():
    db = SessionLocal()
    try:
        t = Track(
            source='youtube',
            source_track_id='test_fail',
            source_page_url='http://example.com/fail',
            title='Fail',
            artist='Tester',
            duration=1.0,
            stream_url='',
            stream_url_expires_at=datetime.utcnow() + timedelta(hours=1),
            processing_status='processing',
            processing_progress=0,
            ingest_locked=False,
            ingest_attempts=0,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        tid = t.id

        # simulate start
        locked = start_processing(tid)
        assert locked is not None
        # simulate failure
        mark_failure(tid)
        t2 = db.query(Track).filter(Track.id == tid).first()
        # since attempts should be 1 (<3), it should be back to processing
        assert t2.processing_status == 'processing'
        assert t2.ingest_locked is False

        # simulate multiple attempts exceed
        for _ in range(3):
            locked = start_processing(tid)
            # if lock failed, try again
            if not locked:
                continue
            mark_failure(tid)
        t3 = db.query(Track).filter(Track.id == tid).first()
        assert t3.processing_status in ('processing', 'failed')
        # if attempts reached, expect failed
        if (t3.ingest_attempts or 0) >= 3:
            assert t3.processing_status == 'failed'
    finally:
        db.query(Track).filter(Track.source_track_id == 'test_fail').delete()
        db.commit()
        db.close()


def test_recover_stuck_tasks():
    db = SessionLocal()
    try:
        t = Track(
            source='youtube',
            source_track_id='stuck_test',
            source_page_url='http://example.com/stuck',
            title='Stuck',
            artist='Tester',
            duration=1.0,
            stream_url='',
            stream_url_expires_at=datetime.utcnow() + timedelta(hours=1),
            processing_status='processing',
            processing_progress=10,
            ingest_locked=True,
            ingest_attempts=1,
            ingest_started_at=datetime.utcnow() - timedelta(minutes=11),
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        ids = recover_stuck_tasks()
        assert isinstance(ids, list)
        assert t.id in ids
        # refresh local object to see DB changes
        db.refresh(t)
        t2 = db.query(Track).filter(Track.id == t.id).first()
        assert t2.ingest_locked is False
        assert t2.processing_status == 'processing'
    finally:
        db.query(Track).filter(Track.source_track_id == 'stuck_test').delete()
        db.commit()
        db.close()
