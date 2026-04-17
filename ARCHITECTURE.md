# Архитектура Omni Player

## Общая схема

```
┌─────────────────────────────────────────────────────────────────┐
│                          Браузер                                │
│  HTML страница → vanilla JS модули → WebSocket + fetch API      │
└─────────────────┬───────────────────────┬───────────────────────┘
                  │ HTTP REST             │ WebSocket
                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FastAPI (Python)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │  /auth   │ │  /rooms  │ │ /stream  │ │  /ws/rooms/{id}    │ │
│  └──────────┘ └──────────┘ └────┬─────┘ └────────┬───────────┘ │
│                                 │                 │             │
│                            yt-dlp            WS Manager        │
│                            ffmpeg          (broadcast state)   │
└─────────────────┬──────────────────────────────────────────────┘
                  │ SQLAlchemy ORM
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PostgreSQL                               │
│   users / rooms / tracks / room_tracks (queue)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Компоненты бэкенда

### `app/main.py`
Точка входа. Регистрирует роутеры, монтирует статику, определяет HTML-маршруты.

```
app.include_router(auth_router)      # /auth
app.include_router(rooms_router)     # /rooms
app.include_router(tracks_router)    # /stream
app.include_router(admin_router)     # /admin
app.include_router(websocket_router) # /ws
app.include_router(player_router)    # /api/player
```

### `app/auth/`
JWT авторизация. Регистрация, логин, получение текущего пользователя. Токены подписываются `SECRET_KEY` из `.env`.

- `routes.py` — эндпоинты `/auth/register`, `/auth/login`, `/auth/me`
- `utils.py` — хеширование паролей (bcrypt), создание/верификация JWT
- `schemas.py` — Pydantic-схемы запросов и ответов

### `app/rooms/`
Управление комнатами: CRUD, очередь треков, список пользователей.

- `routes.py` — все `/rooms/*` эндпоинты
- `schemas.py` — схемы Room, RoomTrack
- `service.py` — бизнес-логика (проверка прав, управление очередью)

### `app/streaming/`
Интеграция с YouTube и SoundCloud через yt-dlp.

- `routes.py` — `/stream/search/*`, `/stream/{id}`, `/stream/room/*`
- `soundcloud.py` — клиент SoundCloud: поиск, получение stream URL, прокси
- `radio_manager.py` — управление ffmpeg-бродкастом

### `app/room/`
Низкоуровневое управление воспроизведением.

- `ffmpeg.py` — запуск/остановка ffmpeg процессов, транскодирование аудио
- `broadcast.py` — рассылка аудиопотока подключённым клиентам
- `manager.py` — менеджер состояния комнат (текущий трек, позиция, паузa)
- `queue.py` — работа с очередью воспроизведения

### `app/websocket/`
WebSocket для синхронизации в реальном времени.

- `router.py` / `routes.py` — WS эндпоинт `/ws/rooms/{room_id}`
- `manager.py` — `ConnectionManager`: хранит открытые соединения, рассылает broadcast
- `handlers/` — обработчики по типу сообщения:
  - `connection.py` — подключение/отключение пользователя
  - `playback.py` — управление воспроизведением
  - `track.py` — смена трека
  - `chat.py` — чат

### `app/database/`
- `models.py` — SQLAlchemy модели (User, Room, Track, RoomTrack)
- `db.py` / `session.py` — AsyncSession, dependency injection
- `__init__.py` — инициализация движка

### `app/admin/`
Эндпоинты администратора: управление пользователями и комнатами.

---

## Схема базы данных

```
users
  id, username, email, hashed_password
  is_active, is_admin, can_create_rooms
  created_at

rooms
  id, name, description, is_public
  owner_id → users.id
  created_at, updated_at

tracks
  id, title, url (stream URL), page_url
  thumbnail, duration, source (youtube/soundcloud)
  created_at, expires_at

room_tracks  (очередь комнаты)
  id, room_id → rooms.id, track_id → tracks.id
  position (порядок в очереди)
  added_by → users.id, added_at
```

---

## Поток воспроизведения трека

```
1. Пользователь вводит URL или выбирает из поиска
2. POST /rooms/{id}/tracks  { url: "..." }
3. Бэкенд вызывает yt-dlp: извлекает stream URL, метаданные, обложку
4. Трек сохраняется в БД (tracks + room_tracks)
5. WebSocket broadcast: { type: "queue_updated", data: [...] }
6. При смене трека — бэкенд запускает ffmpeg → аудиопоток
7. Браузер подключается к /stream/room/{id}/stream
8. ffmpeg транскодирует → отдаёт mp3 чанками
9. WS broadcast синхронизирует позицию у всех слушателей
```

---

## WebSocket синхронизация

```
Клиент A (owner)          Сервер              Клиент B (listener)
      │                      │                        │
      │── playback_control ──►│                        │
      │   { action: "play" }  │──── room_state ───────►│
      │                       │   { is_playing: true } │
      │                       │                        │
      │── track_change ───────►│                        │
      │   { track_id: 42 }    │──── track_change ─────►│
      │                       │   { current_track: {} } │
      │                       │                        │
      │                       │◄── ping ───────────────│
      │                       │─── pong ───────────────►│
```

---

## Авторизация и роли

- **JWT токен** — передаётся в заголовке `Authorization: Bearer <token>` (REST) или `?token=` (WebSocket).
- **Роли в комнате:**
  - `owner` — создатель комнаты, управляет воспроизведением
  - `listener` — слушатель, может писать в чат

---

## Техстек

| Компонент | Технология |
|-----------|-----------|
| Бэкенд | Python 3.11+, FastAPI, Uvicorn |
| ORM | SQLAlchemy 2.x (async) |
| БД | PostgreSQL 15 |
| Аудио | yt-dlp, ffmpeg |
| Аутентификация | JWT (python-jose), bcrypt |
| WebSocket | FastAPI WebSocket (starlette) |
| Контейнеризация | Docker, Docker Compose |
| Фронтенд | Vanilla JS, HTML5 Audio API, Web Audio API |

---

## Конфигурация

Все настройки через переменные окружения (файл `.env`):

| Переменная | Описание | Пример |
|-----------|----------|--------|
| `DATABASE_URL` | URL PostgreSQL | `postgresql+asyncpg://user:pass@localhost/omni_player` |
| `SECRET_KEY` | Секрет JWT | `supersecretkey` |
| `ALGORITHM` | Алгоритм JWT | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Время жизни токена | `30` |
| `SOUNDCLOUD_API_URL` | URL API SoundCloud | `https://api.soundcloud.com` |
| `ROOM_TTL_SECONDS` | TTL неактивной комнаты | `3600` |

---

## Docker

```yaml
# docker-compose.yml
services:
  db:   # PostgreSQL 15
  app:  # FastAPI приложение (порт 3000→8000)
```

Dockerfile устанавливает Python 3.10, системные зависимости (ffmpeg, postgresql-client), копирует код, запускает uvicorn.
