# Omni Player

Многопользовательский музыкальный проигрыватель с поддержкой живого потока и синхронизацией в реальном времени.

## 📁 Структура проекта

```
.
├── backend/           # 🔧 Backend (FastAPI)
│   ├── app/          # Основное приложение
│   ├── templates/    # HTML шаблоны
│   ├── downloads/    # Загруженные файлы
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   └── start.sh      # Скрипт для запуска backend
│
├── frontend/         # 🎨 Frontend
│   ├── frontend-react/  # React приложение (Vite)
│   ├── static/       # Статические файлы
│   ├── *.html        # HTML страницы
│   └── start.sh      # Скрипт для запуска frontend
│
├── docker-compose.yml   # Главный docker-compose для всего проекта
├── start.sh             # Скрипт для запуска всего приложения
└── README.md
```

## 🚀 Быстрый старт

### С помощью Docker (рекомендуется)

```bash
# Запуск всех сервисов
chmod +x start.sh
./start.sh
```

Приложение будет доступно на:
- 📱 Frontend: http://localhost:5173
- 🔌 Backend API: http://localhost:3000
- 📚 API Документация: http://localhost:3000/docs

### Локальная разработка

#### Backend

```bash
cd backend
chmod +x start.sh
./start.sh
```

Backend запустится на http://localhost:8000

#### Frontend

```bash
cd frontend
chmod +x start.sh
./start.sh
```

Frontend запустится на http://localhost:5173

## 🛠 Требования

### Для Docker
- Docker 20.10+
- Docker Compose 2.0+

### Для локальной разработки

**Backend:**
- Python 3.10+
- PostgreSQL 15+
- FFmpeg

**Frontend:**
- Node.js 18+
- npm 9+

## 📖 Документация

- [Architecture](./ARCHITECTURE.md) - Архитектура приложения
- [Backend](./backend/README.md) - Детали backend
- [Frontend](./FRONTEND.md) - Детали frontend
- [Equalizer](./EQUALIZER.md) - Документация эквалайзера
- [Quickstart](./QUICKSTART.md) - Быстрый старт

## 📝 Лицензия

MIT
