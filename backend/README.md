# Omni Player Backend

FastAPI приложение для управления музыкальным потоком с поддержкой WebSocket.

## 🏗 Структура

```
backend/
├── app/
│   ├── main.py              # Точка входа приложения
│   ├── core/                # Конфигурация и зависимости
│   ├── database/            # БД модели и сессии
│   ├── domains/             # Основные домены (auth, rooms, tracks)
│   ├── services/            # Бизнес-логика
│   ├── websocket/           # WebSocket обработчики
│   ├── room/                # Логика комнат
│   └── player/              # API проигрывателя
├── templates/               # HTML шаблоны
├── downloads/               # Загруженные файлы
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── start.sh
```

## 🚀 Быстрый старт

### С Docker

```bash
docker-compose up
```

### Локально

```bash
# Создать виртуальное окружение
python3 -m venv venv
source venv/bin/activate

# Установить зависимости
pip install -r requirements.txt

# Запустить PostgreSQL (в отдельном терминале)
docker-compose up db -d

# Запустить сервер
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 🔌 API

- **Документация:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

## 🗄️ База данных

- PostgreSQL 15
- Миграции: `app/database/migrations/`

## 🔐 Переменные окружения

Создайте `.env` файл:

```env
DATABASE_URL=postgresql://user:password@db:5432/omni_player
SECRET_KEY=your-secret-key-here
```

## 📦 Зависимости

Основные:
- FastAPI 0.104+
- SQLAlchemy 2.0+
- Pydantic 2.0+
- python-jose + passlib (JWT + хеширование паролей)
- FFmpeg (обработка аудио)

## 🐛 Отладка

```bash
# Запустить с отладкой
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --log-level debug

# Проверить здоровье приложения
curl http://localhost:8000/health
```
