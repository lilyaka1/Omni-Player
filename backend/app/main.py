import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

# Directories
static_dir = backend_dir / "static"
output_dir = backend_dir / "output"
tts_audio_dir = backend_dir / "tts_audio"
uploads_dir = static_dir / "uploads"
avatars_dir = uploads_dir / "avatars"
covers_dir = uploads_dir / "covers"
room_covers_dir = uploads_dir / "room-covers"
static_dir.mkdir(exist_ok=True)
output_dir.mkdir(exist_ok=True)
tts_audio_dir.mkdir(exist_ok=True)
uploads_dir.mkdir(parents=True, exist_ok=True)
avatars_dir.mkdir(parents=True, exist_ok=True)
covers_dir.mkdir(parents=True, exist_ok=True)
room_covers_dir.mkdir(parents=True, exist_ok=True)

# ── Lifespan: startup / shutdown ───────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────
    # Инициализируем VoiceInsert таблицу
    try:
        from app.database.session import engine
        from app.database.models import Base
        from app.voice_inserts.model import VoiceInsert  # noqa: ensure table exists
        with engine.begin() as conn:
            Base.metadata.create_all(conn)
        logger.info("✅ VoiceInsert table ready")
    except Exception as e:
        logger.warning(f"⚠️ VoiceInsert table init: {e}")

    # Read-only schema consistency check (no ALTER TABLE — avoids race condition)
    try:
        from app.database.session import engine
        from app.database.auto_migrate import check_schema_consistency
        check_schema_consistency(engine)
    except RuntimeError as e:
        # Fatal — app won't start
        logger.error(f"FATAL: {e}")
        raise
    except Exception as e:
        logger.warning(f"⚠️ schema check failed: {e}")

    # Prewarm TTS cache + запускаем timeout checker
    import asyncio
    try:
        from app.voice_inserts.tts import prewarm_cache
        from app.voice_inserts.queue import insert_timeout_checker
        from app.playback.sync import sync_service
        asyncio.create_task(prewarm_cache())
        asyncio.create_task(insert_timeout_checker())
        sync_service.start()
        # start ingestion worker
        # Ingest worker disabled to avoid schema issues in this setup.
        # Uncomment the following lines if the database schema is fully migrated.
        # try:
        #     from app.services.ingest_worker import run_worker
        #     asyncio.create_task(run_worker())
        #     logger.info("✅ Ingest worker started")
        # except Exception as e:
        #     logger.warning(f"⚠️ Ingest worker failed to start: {e}")
        logger.info("✅ Voice Insert background tasks started")
    except Exception as e:
        logger.warning(f"⚠️ Voice Insert tasks: {e}")

    logger.info("🚀 Omni Player API started")
    yield

    # ── Shutdown ────────────────────────────────────────────────────────────
    try:
        from app.playback.sync import sync_service
        sync_service.stop()
    except Exception:
        pass
    logger.info("🛑 Omni Player API shutting down...")


app = FastAPI(title="Omni Player API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static mounts
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
app.mount("/tts", StaticFiles(directory=str(tts_audio_dir)), name="tts")
logger.info(f"📁 Static: {static_dir}, TTS: {tts_audio_dir}")

# ── Routers ─────────────────────────────────────────────────────────────────
def _register(name: str, module_path: str):
    try:
        import importlib
        module = importlib.import_module(module_path)
        router = getattr(module, "router", None)
        if router:
            app.include_router(router)
            # Backward compatibility for old frontend bundles that call /api/auth/*.
            if name == "Auth":
                app.include_router(router, prefix="/api")
            logger.info(f"✅ {name} router registered")
        else:
            logger.warning(f"⚠️ {name}: no router attribute")
    except ImportError as e:
        logger.warning(f"⚠️ {name} not available: {e}")

_register("Auth", "app.domains.auth.router")
_register("Rooms", "app.domains.rooms.router")
_register("Tracks", "app.domains.tracks.router")
_register("Player", "app.player.routes")
_register("Profiles", "app.domains.profiles.router")
_register("Voice", "app.voice_inserts.router")
_register("WebSocket", "app.websocket.router")
_register("Stream", "app.stream.router")

# ── Routes ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/health")
async def legacy_health():
    return {"status": "ok", "version": "1.0.0"}

