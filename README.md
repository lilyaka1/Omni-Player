<div align="center">

# 🎧 OmniPlayer

**Совместное прослушивание музыки в реальном времени**

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[🚀 Демо](#запуск-проекта) • [📖 Документация](#документация-api) • [🧪 Тесты](#тестирование)

</div>

---

## ✨ О проекте

**OmniPlayer** — веб-приложение для организации совместного прослушивания музыки. Создавайте комнаты, приглашайте друзей, управляйте общей очередью треков и наслаждайтесь синхронным воспроизведением с встроенным чатом.

### 🔥 Ключевые возможности

| Функция | Описание |
|---------|----------|
| 🎵 **Загрузка треков** | Личная библиотека + поиск через SoundCloud/YouTube |
| 🏠 **Комнаты** | Публичные и приватные (с паролем) комнаты для прослушивания |
| ⏯️ **Синхронизация** | WebSocket-синхронизация воспроизведения с задержкой < 1 сек |
| 💬 **Чат** | Текстовый чат в реальном времени с модерацией |
| 🎤 **Voice Inserts** | TTS-анонсы и RVC-обработка голоса |
| 📱 **Адаптивный UI** | Современный интерфейс на React + TailwindCSS |

---

## 🏗️ Архитектура

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │◄────┤   FastAPI   │◄────┤  PostgreSQL │
│   SPA       │ WS  │   Backend   │     │    + SQLAlchemy
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                    ┌─────┴─────┐
                    │  WebSocket │
                    │  Gateway   │
                    └─────────────┘
```

**Стек технологий:**
- **Backend:** `FastAPI` • `Python 3.11+` • `SQLAlchemy` • `Alembic`
- **Frontend:** `React 18` • `Vite` • `TailwindCSS`
- **База данных:** `PostgreSQL 15`
- **Инфраструктура:** `Docker` • `Docker Compose`
- **Медиа:** `FFmpeg` • `yt-dlp` • `HLS Streaming`

---

## 🚀 Запуск проекта

### Быстрый старт (Docker Compose)

```bash
# Клонировать репозиторий
git clone https://github.com/lilyaka1/Omni-Player.git
cd Omni-Player

# Запуск всего стека
docker compose up --build
```

- 🌐 **Frontend:** http://localhost:5173
- 🔧 **Backend API:** http://localhost:3000
- 📚 **API Docs:** http://localhost:3000/docs

### Локальная разработка

```bash
# === Backend ===
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Настройка БД (PostgreSQL)
cp .env.example .env
alembic upgrade head

# Запуск
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# === Frontend ===
cd ../frontend
npm install
npm run dev
```

---

## 🧪 Тестирование

```bash
# Запуск всех тестов
make test

# Покрытие кода
make test-coverage

# Только auth тесты
make test-auth

# Только API тесты
make test-api
```

---

## 📡 Роутеры API

| Модуль | Путь | Описание |
|--------|------|----------|
| 🔐 Auth | `/api/auth` | JWT авторизация и регистрация |
| 🏠 Rooms | `/api/rooms` | Управление комнатами |
| 🎵 Tracks | `/api/tracks` | Загрузка и поиск треков |
| ▶️ Player | `/api/player` | Управление воспроизведением |
| 👤 Profiles | `/api/profiles` | Профили пользователей |
| 🎤 Voice | `/api/voice` | TTS и RVC интеграция |
| 📡 WebSocket | `/ws` | Real-time коммуникации |
| 🎬 Stream | `/api/stream` | HLS аудио стриминг |

---

## 📖 Документация API

После запуска backend:
- **Swagger UI:** http://localhost:3000/docs
- **ReDoc:** http://localhost:3000/redoc

---

## 🛠️ Makefile команды

```bash
make help          # Справка по командам
make venv          # Создать виртуальное окружение
make install-dev   # Установить dev-зависимости
make test          # Запуск всех тестов
make test-coverage # Тесты с покрытием
make ingest-once   # Запуск ingest worker (разово)
make ingest-loop   # Запуск ingest worker (цикл)
make clean         # Очистка окружения
```

---

## 📁 Структура проекта

```
Omni-Player/
├── 📂 backend/                 # FastAPI backend
│   ├── app/
│   │   ├── main.py            # Точка входа
│   │   ├── domains/           # Auth, Rooms, Tracks, Profiles
│   │   ├── playback/          # Синхронизация, контроллер
│   │   ├── room/              # Менеджер, очередь, HLS
│   │   ├── websocket/         # WebSocket handlers
│   │   ├── stream/            # HLS стриминг
│   │   └── voice_inserts/     # TTS + RVC
│   ├── tests/                 # 15+ тестовых модулей
│   └── requirements.txt
│
├── 📂 frontend/               # React SPA
│   ├── src/
│   │   ├── pages/             # Home, Room, Library, Live, Profile
│   │   ├── components/        # Player, Queue, Chat, Search
│   │   ├── styles/            # Tailwind + кастомные CSS
│   │   └── utils/             # AudioManager, Auth, WebSocket
│   └── package.json
│
├── 📂 scripts/                # Dev скрипты
├── docker-compose.yml         # Полный стек
├── Makefile                   # Dev команды
└── README.md                  # Вы здесь ✨
```

---

## 🗃️ База данных

**Ключевые сущности:**
- `users` — пользователи (JWT, роли)
- `rooms` — комнаты (владелец, пароль, состояние)
- `tracks` — метаданные треков (источник, длительность)
- `queue_items` — очередь воспроизведения
- `messages` — чат комнаты

---

## 🔮 Roadmap

- [ ] Плавающая калибровка пинга для точной синхронизации
- [ ] Балансировка нагрузки и кластеризация WebSocket
- [ ] Социальные функции: профили, рекомендации, подписки
- [ ] Мобильное приложение (React Native)
- [ ] Интеграция с Spotify/Apple Music API

---

## 📄 Лицензия

Распространяется под лицензией MIT. См. [LICENSE](LICENSE) для подробностей.

---

<div align="center">

**Made with ❤️ for music lovers**

[⭐ Star this repo](https://github.com/lilyaka1/Omni-Player) if you like it!

</div>
