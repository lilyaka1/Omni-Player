import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

static_dir = backend_dir / "static"

static_dir.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting Omni Player API")
    from app.playback.sync import sync_service

    sync_service.start()
    # Restore automatic advancement for rooms that already had queued tracks when
    # the API restarted. Playback must not depend on an admin browser reconnecting.
    try:
        from app.database.models import RoomTrack
        from app.database.session import SessionLocal
        from app.playback.loop import playback_loop

        db = SessionLocal()
        try:
            room_ids = [row[0] for row in db.query(RoomTrack.room_id).distinct().all()]
        finally:
            db.close()
        for room_id in room_ids:
            playback_loop.register_room(room_id)
    except Exception:
        logger.exception("Unable to restore room playback loops")
    yield
    sync_service.stop()
    try:
        from app.playback.loop import playback_loop
        playback_loop.shutdown()
    except Exception:
        logger.exception("Unable to stop room playback loops")
    logger.info("🛑 Shutting down Omni Player API")


app = FastAPI(
    title="Omni Player API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# -----------------------------
# ROUTER REGISTRATION
# -----------------------------
def _register(name: str, module_path: str):
    try:
        import importlib
        module = importlib.import_module(module_path)
        router = getattr(module, "router", None)

        if router:
            app.include_router(router)
            logger.info(f"✅ {name} router loaded: {module_path}")
        else:
            logger.warning(f"⚠️ {name}: router not found in {module_path}")

    except Exception as e:
        logger.warning(f"⚠️ {name} failed: {e}")


_register("Auth", "app.domains.auth.router")
_register("Rooms", "app.domains.rooms.router")
_register("Tracks", "app.domains.tracks.router")
_register("Player", "app.player.routes")
_register("Profiles", "app.domains.profiles.router")
_register("WebSocket", "app.websocket.router")

# 🔥 ВАЖНО — ЭТО ДОЛЖНО БЫТЬ
_register("Stream", "app.stream.router")
_register("Media", "app.media.image_proxy")


# -----------------------------
# HEALTHCHECK
# -----------------------------
@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/health")
async def api_health():
    return {"status": "ok"}