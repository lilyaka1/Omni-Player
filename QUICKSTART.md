# Быстрый старт

## Требования

- Python 3.11+
- PostgreSQL 15+
- ffmpeg
- Docker + Docker Compose (опционально, но удобно)

---

## Вариант 1 — Docker (рекомендуется)

Это самый простой способ. Требуется только Docker.

```bash
# 1. Скопировать конфиг
cp .env.example .env

# 2. Открыть .env и заполнить:
#    SECRET_KEY — любая длинная случайная строка
#    Остальное можно оставить по умолчанию для локального запуска

# 3. Запустить
docker compose up -d

# 4. Создать базу данных (первый запуск)
docker compose exec app python init_db.py

# 5. Создать тестового пользователя
docker compose exec app python setup_user.py
```

Открыть: http://localhost:3000

### Проверка, что backend и frontend поднялись

```bash
# health-check API
curl -sS http://localhost:3000/health
# ожидается: {"status":"ok"}

# ключевые frontend-страницы
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/player
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/user
# ожидается: 200, 200, 200
```

### Полезные команды Docker

```bash
# Посмотреть логи
docker compose logs -f app

# Остановить
docker compose down

# Остановить и удалить данные БД
docker compose down -v

# Перебилдить после изменений в коде
docker compose up -d --build
```

---

## Вариант 2 — Локально

### 1. Установить зависимости

**macOS:**
```bash
brew install postgresql ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install postgresql ffmpeg
```

### 2. Создать базу данных PostgreSQL

```bash
createdb omni_player
createuser omni_user --pwprompt
psql -c "GRANT ALL ON DATABASE omni_player TO omni_user;"
```

### 3. Настроить Python окружение

```bash
python -m venv venv
source venv/bin/activate       # macOS/Linux
# venv\Scripts\activate       # Windows

pip install -r requirements.txt
```

### 4. Настроить переменные окружения

```bash
cp .env.example .env
```

Открыть `.env` и заполнить:

```env
DATABASE_URL=postgresql+asyncpg://omni_user:your_password@localhost/omni_player
SECRET_KEY=your-super-secret-key-change-this-to-something-long
```

### 5. Инициализировать БД и создать пользователя

```bash
python init_db.py
python setup_user.py
```

### 6. Запустить сервер

```bash
uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
```

Открыть: http://localhost:3000

---

## Первые шаги в приложении

1. Перейти на http://localhost:3000
2. Нажать «Войти» → ввести данные из `setup_user.py` (по умолчанию `admin` / `admin123`)
3. Создать комнату
4. Поделиться ссылкой на комнату с другим пользователем
5. Найти трек через поиск SoundCloud → добавить в очередь
6. Нажать Play — все в комнате услышат синхронно

---

## Передать проект другому разработчику

### Через сохранённый Docker-образ (без реестра)

```bash
# Упаковать
docker build -t omni-player .
docker save omni-player | gzip > omni-player.tar.gz

# На другой машине
docker load < omni-player.tar.gz
docker compose up -d
```

### Через Docker Hub

```bash
# Запушить
docker build -t yourname/omni-player:latest .
docker push yourname/omni-player:latest

# На другой машине — в docker-compose.yml заменить build: . на:
# image: yourname/omni-player:latest
docker compose up -d
```

### Через git

```bash
# Отправить
git push origin main

# На другой машине
git clone <url>
cd omni-player
cp .env.example .env
# Заполнить .env — особенно DATABASE_URL и SECRET_KEY
docker compose up -d
docker compose exec app python init_db.py
docker compose exec app python setup_user.py
```

> Файл `.env` с реальными секретами НЕ коммить в репозиторий. Передавай его отдельно.

---

## Частые проблемы

### `connection refused` при подключении к БД

Убедись, что PostgreSQL запущен и `DATABASE_URL` в `.env` правильный.

```bash
# Проверить, слушает ли PostgreSQL
pg_isready -h localhost -p 5432
```

### `ffmpeg not found`

Установить ffmpeg и убедиться, что он есть в `$PATH`:

```bash
ffmpeg -version
```

### Порт 3000 занят

```bash
lsof -ti:3000 | xargs kill -9
```

### Трек не воспроизводится

Обновить yt-dlp (stream URL протухают, и yt-dlp нужно обновлять под изменения в YouTube/SoundCloud):

```bash
pip install -U yt-dlp
# или в Docker:
docker compose exec app pip install -U yt-dlp
```
