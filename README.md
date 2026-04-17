# Omni Player

Совместный музыкальный плеер с синхронизацией в реальном времени. Несколько пользователей заходят в одну комнату и слушают музыку вместе — треки с YouTube и SoundCloud, синхронное воспроизведение, чат, управление очередью.

---

## Быстрый старт

### С Docker (рекомендуется)

```bash
cp .env.example .env
# Отредактируй .env — задай SECRET_KEY и POSTGRES_PASSWORD
docker compose up -d
# Первый запуск: инициализация БД и создание тестового пользователя
docker compose exec app python init_db.py
docker compose exec app python setup_user.py
```

Открыть: http://localhost:3000

### Локально (для разработки)

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Заполнить .env
python init_db.py
python setup_user.py   # создаёт тестового пользователя
uvicorn app.main:app --port 3000 --reload
```

Требования: Python 3.11+, PostgreSQL, ffmpeg

---

## Архитектура

```
Браузер → FastAPI (HTTP + WebSocket) → PostgreSQL
                 ↓
         yt-dlp + ffmpeg → аудиопоток → Браузер
```

- **FastAPI** — REST API + WebSocket-сервер
- **PostgreSQL** — пользователи, комнаты, треки, очередь
- **yt-dlp** — поиск на YouTube/SoundCloud, получение stream URL
- **ffmpeg** — транскодирование аудио в mp3 для стриминга
- **WebSocket** — синхронизация в реальном времени: воспроизведение, чат, очередь

---

## Страницы

| URL         | Описание                               |
| ----------- | ---------------------------------------------- |
| `/`       | Главная страница                   |
| `/login`  | Вход / Регистрация              |
| `/player` | Личная библиотека + поиск |
| `/user`   | Комнатный плеер                  |
| `/health` | Health-check API                  |

---

## Структура проекта

```
app/
  domains/
    auth/     — JWT авторизация
    rooms/    — CRUD комнат, очередь, участники
    tracks/   — поиск и стриминг треков
  room/       — runtime очереди, broadcast, ffmpeg
  websocket/  — WS endpoint и handlers
  player/     — роуты player-страниц
  admin/      — admin маршруты
  database/   — SQLAlchemy модели и сессии
  core/       — конфиг и зависимости
static/
  js/         — фронтенд (vanilla JS)
  css/        — стили
```

---

## API

Интерактивная документация: **http://localhost:3000/docs** (Swagger UI)

Основные эндпоинты:

```
POST /auth/login              — получить JWT токен
GET  /rooms                   — список комнат
POST /rooms                   — создать комнату
GET  /rooms/{id}              — информация о комнате
GET  /stream/search/soundcloud — поиск на SoundCloud
GET  /stream/room/{room_id}/status — статус room broadcast
GET  /stream/room/{room_id}/stream — mp3 stream комнаты
WS   /ws/rooms/{room_id}      — WebSocket соединение
GET  /health                  — health-check
```

## Быстрая проверка после запуска

```bash
curl -sS http://localhost:3000/health
# => {"status":"ok"}

curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/player
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/user
# => 200 / 200 / 200
```

---

## Переменные окружения

| Переменная            | Описание                                                 |
| ------------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`                | URL к PostgreSQL                                                |
| `SECRET_KEY`                  | Секрет для JWT (обязательно поменяй!) |
| `ALGORITHM`                   | Алгоритм JWT (по умолчанию HS256)             |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Время жизни токена в минутах             |
| `SOUNDCLOUD_API_URL`          | URL API SoundCloud                                               |
| `YOUTUBE_API_KEY`             | API ключ YouTube (опционально)                    |
| `ROOM_TTL_SECONDS`            | Время жизни неактивной комнаты        |

Смотри [.env.example](.env.example) для примеров значений.

---

## Деплой и передача проекта

### Передать проект через Docker-образ (без репозитория)

```bash
# 1. Собрать образ
docker build -t omni-player .

# 2. Экспортировать в файл
docker save omni-player | gzip > omni-player.tar.gz

# 3. Отправить файл на другой компьютер (scp, флешка, облако)

# 4. На другом компьютере — загрузить образ
docker load < omni-player.tar.gz

# 5. Запустить через docker compose
docker compose up -d
```

### Передать через Docker Hub (публичный/приватный registry)

```bash
# 1. Логин (один раз)
docker login

# 2. Собрать и запушить
docker build -t yourname/omni-player:latest .
docker push yourname/omni-player:latest

# 3. На другом компьютере
docker pull yourname/omni-player:latest
docker compose up -d
```

> В docker-compose.yml замени `build: .` на `image: yourname/omni-player:latest`.

### Передать через git + Docker Compose (рекомендуется для команды)

```bash
# 1. Отправить код в репозиторий (GitHub/GitLab/etc.)
git push origin main

# 2. На другом компьютере
git clone <repo-url>
cd omni-player
cp .env.example .env
# Заполнить .env
docker compose up -d
```

---

## Документация

- [ARCHITECTURE.md](ARCHITECTURE.md) — архитектура системы, потоки данных, схема БД
- [FRONTEND.md](FRONTEND.md) — гайд для фронтендера: все модули JS, API, WebSocket
- [QUICKSTART.md](QUICKSTART.md) — подробная инструкция по запуску
- [EQUALIZER.md](EQUALIZER.md) — реализация эквалайзера
