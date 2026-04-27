from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.database.session import engine
from app.database.models import Base
from app.core.config import settings

# Домены
from app.domains.auth.router import router as auth_router
from app.domains.rooms.router import router as rooms_router
from app.domains.tracks.router import router as tracks_router

# Admin
# from app.admin.routes import router as admin_router

# WebSocket
# from app.websocket.router import router as websocket_router

# Player
# from app.player.routes import router as player_router

import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup и shutdown приложения."""
    # ── Startup ──────────────────────────────────────────────────────
    with engine.begin() as conn:
        Base.metadata.create_all(conn)

    from app.database.session import SessionLocal
    from app.database.models import Room

    db = SessionLocal()
    try:
        rooms = db.query(Room).filter(Room.is_playing == True).all()
        for room in rooms:
            room.is_playing = False
        if rooms:
            db.commit()
            print(f"🔄 Startup: сброшен is_playing для {len(rooms)} комнат")
    except Exception as e:
        print(f"⚠️ Startup room reset error: {e}")
    finally:
        db.close()

    print("✅ Application startup complete")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────
    from app.room.manager import room_manager

    print("🛑 Shutting down broadcasts...")
    room_ids = list(room_manager.broadcasts.keys())
    for room_id in room_ids:
        try:
            await room_manager.stop_room(room_id)
        except Exception as e:
            print(f"⚠️ Failed to stop room {room_id}: {e}")

    print("✅ Application shutdown complete")


app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Роутеры
app.include_router(auth_router)
app.include_router(rooms_router)
app.include_router(tracks_router)
# app.include_router(admin_router)
# app.include_router(websocket_router)
# app.include_router(player_router)

# Статика
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
static_dir = os.path.join(base_dir, "static")
if os.path.exists(static_dir):
    print(f"✅ Mounting static files from: {static_dir}")
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
else:
    print(f"❌ Static directory not found: {static_dir}")

# HTML маршруты
templates_dir = os.path.join(base_dir, "templates")


def _serve_html(path: str):
    if os.path.exists(path):
        return FileResponse(path, media_type="text/html")
    return {"error": f"{os.path.basename(path)} not found"}


@app.get("/live")
async def live():
    p = os.path.join(base_dir, "live.html")
    return _serve_html(p)


@app.get("/live.html")
async def live_html():
    p = os.path.join(base_dir, "live.html")
    return _serve_html(p)


@app.get("/login")
async def login():
    p = os.path.join(base_dir, "login.html")
    return _serve_html(p)


@app.get("/login.html")
async def login_html():
    p = os.path.join(base_dir, "login.html")
    return _serve_html(p)


@app.get("/user")
async def user():
    return _serve_html(os.path.join(templates_dir, "room", "player.html"))


@app.get("/user.html")
async def user_html():
    p = os.path.join(base_dir, "user.html")
    return _serve_html(p)


@app.get("/player")
async def player():
    return _serve_html(os.path.join(base_dir, "player.html"))


@app.get("/player.html")
async def player_html():
    p = os.path.join(base_dir, "player.html")
    return _serve_html(p)


@app.get("/")
async def root():
    return _serve_html(os.path.join(templates_dir, "base.html"))


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
