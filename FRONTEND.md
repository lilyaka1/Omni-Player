# Гайд для фронтенд-разработчика

Полный справочник по фронтенду Omni Player. Бэкенд — FastAPI + WebSocket. Фронтенд — vanilla JS без фреймворков и сборщиков.

---

## Содержание

1. [Структура проекта](#структура-проекта)
2. [Страницы и маршруты](#страницы-и-маршруты)
3. [Авторизация](#авторизация)
4. [REST API](#rest-api)
5. [WebSocket протокол](#websocket-протокол)
6. [JS модули](#js-модули)
7. [Статика](#статика)
8. [Запуск для разработки](#запуск-для-разработки)
9. [Типичные грабли](#типичные-грабли)

---

## Структура проекта

```
omni-player/
├── login.html                  ← Страница входа/регистрации
├── player.html                 ← Личная библиотека + поиск
├── live.html                   ← Альтернативная live-страница
├── user.html                   ← Альтернативная room-страница
├── templates/
│   ├── base.html               ← Главная (список комнат)
│   └── room/
│       ├── player.html         ← Комнатный плеер
│       └── admin.html          ← Админ/live плеер
├── static/
│   ├── js/
│   │   ├── auth.js             ← Логика логина/регистрации
│   │   └── room/
│   │       ├── globals.js      ← Общее состояние (roomId, token, ...)
│   │       ├── websocket.js    ← WS соединение и диспетчер
│   │       ├── player.js       ← Управление воспроизведением
│   │       ├── queue.js        ← Управление очередью
│   │       ├── chat.js         ← Чат
│   │       ├── stream.js       ← Аудио-стриминг
│   │       ├── auth-ui.js      ← UI авторизации в комнате
│   │       ├── equalizer.js    ← DSP эквалайзер
│   │       └── equalizer-ui.js ← UI эквалайзера
│   └── css/
│       └── main.css
└── app/                        ← Бэкенд (Python/FastAPI)
```

---

## Страницы и маршруты

| URL | Файл | Описание |
|-----|------|----------|
| `GET /` | `templates/base.html` | Главная — список комнат |
| `GET /login` | `login.html` | Вход / Регистрация |
| `GET /player` | `player.html` | Личная библиотека + поиск |
| `GET /user` | `templates/room/player.html` | Комнатный плеер (основной UI комнаты) |
| `GET /user.html` | `user.html` | Альтернативная страница комнаты |
| `GET /live` | `templates/room/admin.html` | Админ / live-стрим |
| `GET /health` | — | Проверка сервера `{"status": "ok"}` |

---

## Обычный плеер (`/player`)

Обычный плеер не удалён и работает отдельно от комнатного UI.

- Страница: `player.html`
- Роут: `GET /player`
- Авторизация: через `localStorage.access_token`
- Основной API: `/api/player/*`

Что умеет страница `/player`:

- Добавлять треки по URL в личную библиотеку.
- Искать треки по YouTube и SoundCloud и добавлять результат в библиотеку.
- Импортировать плейлисты.
- Воспроизводить треки (локальный файл через `/api/player/audio/{track_id}` или `stream_url`).
- Менять настройки папки загрузки (`/api/player/settings`).

Для `/player` используй раздел `Библиотека и поиск — /api/player` ниже в этом документе.

---

## Авторизация

JWT-авторизация. Токен хранится в `localStorage`.

### Вход

```javascript
const res = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'user', password: 'pass' })
});
const { access_token } = await res.json();
// /login и /player используют ключ access_token
localStorage.setItem('access_token', access_token);
// /user (room UI) использует ключ token
localStorage.setItem('token', access_token);
```

### Регистрация

```javascript
const res = await fetch('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'user', password: 'pass', email: 'u@example.com' })
});
```

### Авторизованные запросы

```javascript
const token = localStorage.getItem('token');
const res = await fetch('/rooms', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Получить текущего пользователя

```javascript
// GET /auth/me — требует Bearer токен
const res = await fetch('/auth/me', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const user = await res.json();
// { id, username, email, is_admin, can_create_rooms }
```

---

## REST API

Base URL: `http://localhost:3000`

> Интерактивная документация: **http://localhost:3000/docs** (Swagger UI)

---

### Авторизация — `/auth`

| Метод | Путь | Тело / Примечание |
|-------|------|-------------------|
| `POST` | `/auth/register` | `{ username, password, email? }` |
| `POST` | `/auth/login` | `{ username, password }` → `{ access_token, token_type }` |
| `GET` | `/auth/me` | Требует Bearer токен |

---

### Комнаты — `/rooms`

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `GET` | `/rooms` | Нет | Список всех комнат |
| `POST` | `/rooms` | Да | Создать `{ name, description? }` |
| `GET` | `/rooms/my/rooms` | Да | Мои комнаты |
| `GET` | `/rooms/{room_id}` | Нет | Детали комнаты |
| `PATCH` | `/rooms/{room_id}` | Да (владелец) | Обновить комнату |
| `DELETE` | `/rooms/{room_id}` | Да (владелец) | Удалить комнату |
| `GET` | `/rooms/{room_id}/playback-state` | Нет | Текущее состояние плеера |
| `POST` | `/rooms/{room_id}/join` | Да | Войти в комнату |
| `POST` | `/rooms/{room_id}/leave` | Да | Выйти из комнаты |
| `GET` | `/rooms/{room_id}/users` | Нет | Список пользователей в комнате |

#### Треки / Очередь комнаты

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/rooms/{room_id}/tracks` | Да | Добавить трек `{ source, source_track_id, title, artist, duration, stream_url, thumbnail?, genre? }` |
| `GET` | `/rooms/{room_id}/tracks` | Нет | Получить очередь |
| `DELETE` | `/rooms/{room_id}/tracks/{track_id}` | Да | Удалить трек |
| `DELETE` | `/rooms/{room_id}/tracks` | Да | Очистить очередь |
| `PUT` | `/rooms/{room_id}/tracks/reorder` | Да | Переупорядочить `{ order: [track_id, ...] }` |
| `POST` | `/rooms/{room_id}/tracks/{track_id}/refresh-url` | Да | Обновить истёкший stream URL |

---

### Стриминг — `/stream`

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/stream/search/soundcloud?query=...&limit=...` | Поиск на SoundCloud |
| `GET` | `/stream/queue/{room_id}` | Очередь комнаты со stream-ссылками |
| `GET` | `/stream/room/{room_id}/status` | Статус бродкаста |
| `GET` | `/stream/room/{room_id}/stream` | Live mp3-аудиопоток |

### Библиотека и поиск — `/api/player`

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `GET` | `/api/player/library` | Да | Библиотека пользователя |
| `POST` | `/api/player/library` | Да | Добавить трек по URL `{ url }` |
| `DELETE` | `/api/player/library/{track_id}` | Да | Удалить трек |
| `POST` | `/api/player/playlists/import` | Да | Импорт плейлиста `{ playlist_url, create_playlist, is_album }` |
| `GET` | `/api/player/audio/{track_id}` | Да | Отдать локальный mp3-файл |
| `POST` | `/api/player/tracks/play` | Да | Инкремент play count `{ track_id }` |
| `GET` | `/api/player/search/soundcloud` | Да | Поиск для страницы `/player` |
| `GET` | `/api/player/search/youtube` | Да | Поиск для страницы `/player` |
| `GET` | `/api/player/settings` | Да | Получить настройки загрузки |
| `POST` | `/api/player/settings` | Да | Сохранить настройки загрузки |

#### Формат ответа поиска

```javascript
// YouTube
{
  "tracks": [{
    "id": "dQw4w9WgXcQ",
    "title": "Название",
    "duration": 213,
    "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    "page_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "source": "youtube"
  }]
}

// SoundCloud — ВНИМАНИЕ: поле называется track_page_url, не page_url!
{
  "tracks": [{
    "id": "123456",
    "title": "Название",
    "duration": 180,
    "thumbnail": "https://i1.sndcdn.com/artworks-...-t500x500.jpg",
    "track_page_url": "https://soundcloud.com/artist/track",
    "source": "soundcloud"
  }]
}
```

---

### Админка — `/admin`

Требует токен администратора.

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/admin/users` | Все пользователи |
| `GET` | `/admin/rooms` | Все комнаты |
| `POST` | `/admin/users/{user_id}/block` | Заблокировать |
| `POST` | `/admin/users/{user_id}/unblock` | Разблокировать |
| `POST` | `/admin/users/{user_id}/grant-create-rooms` | Разрешить создание комнат |
| `POST` | `/admin/users/{user_id}/revoke-create-rooms` | Отозвать разрешение |

---

## WebSocket протокол

### Подключение

```javascript
const token = localStorage.getItem('token');
const ws = new WebSocket(`ws://localhost:3000/ws/rooms/${roomId}?token=${token}`);
```

Авторизация через query-параметр `?token=`.

### Клиент → Сервер

```json
// Ping (keep-alive)
{ "type": "ping" }

// Чат
{ "type": "chat", "content": "привет" }

// Смена трека (можно передать id)
{ "type": "track_change", "track_id": 42 }

// Смена трека (можно передать полный объект track)
{ "type": "track_change", "track": { "id": "123", "title": "..." } }

// Управление воспроизведением (фактически поддержаны play/pause)
{ "type": "playback_control", "action": "play" }
{ "type": "playback_control", "action": "pause" }
```

### Сервер → Клиент

```json
// Состояние комнаты (при подключении)
{
  "type": "room_state",
  "data": {
    "current_track": { "id": 1, "title": "...", "artist": "...", "thumbnail": "..." },
    "is_playing": true,
    "position": 34.2,
    "users": 3,
    "user_role": "RoomRoleEnum.USER"
  }
}

// Кол-во пользователей
{ "type": "user_count", "count": 5 }

// Сообщение чата
{ "type": "chat", "user": "alice", "content": "привет", "timestamp": "..." }

// Смена трека (один из вариантов событий)
{ "type": "track_change", "data": { "current_track": {...}, "is_playing": true } }

// Трек сменился (используется в room queue manager)
{ "type": "track_changed", "track": { "id": 1, "title": "...", "started_at": 1710000000 } }

// Очередь обновлена
{ "type": "queue_updated" }

// Ошибка
{ "type": "error", "message": "Unauthorized" }
```

---

## JS модули

Все модули в `static/js/room/`. Подключаются отдельными `<script>` тегами. Никаких ES-модулей, никаких бандлеров. Общее состояние — в `globals.js`.

| Модуль | Что делает |
|--------|-----------|
| `globals.js` | Глобальные переменные: `roomId`, `token`, `currentUser`, `isPlaying`, `currentTrack`, `ws` |
| `websocket.js` | Подключение к WS, диспетчер входящих сообщений, хелпер `sendWS(type, data)` |
| `player.js` | Инициализация room UI после логина, автоподключение к первой комнате |
| `queue.js` | Загрузка и рендер очереди из `/stream/queue/{room_id}` |
| `chat.js` | Рендер чата, отправка через WS |
| `stream.js` | Подключение к live-стриму `/stream/room/{id}/stream`, retry/stall логика |
| `auth-ui.js` | Форма логина если нет токена, чтение/запись `localStorage` |
| `equalizer.js` | 10-полосный эквалайзер Web Audio API |
| `equalizer-ui.js` | UI эквалайзера (ползунки, пресеты) |
| `auth.js` | Логика страницы `/login` (формы входа и регистрации) |

---

## Статика

| Путь | Описание |
|------|----------|
| `/static/js/auth.js` | Страница логина |
| `/static/js/room/*.js` | Модули плеера |
| `/static/css/main.css` | Основные стили |
| `/static/img/default-track.svg` | Фолбэк-обложка трека |

Раздаётся FastAPI по маршруту `/static/**`.

---

## Запуск для разработки

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # заполнить DATABASE_URL, SECRET_KEY
python init_db.py
python setup_user.py   # создать тестового пользователя
uvicorn app.main:app --port 3000 --reload
```

Swagger UI: http://localhost:3000/docs

---

## Типичные грабли

- **Два формата токена в фронте:** страница `/player` использует `localStorage.access_token`, room UI (`/user`) использует `localStorage.token`. Не смешивай ключи.
- **Истёкший токен:** JWT протухает. При 401 — редирект на `/login`.
- **WS переподключение:** Реализуй reconnect — сервер может перезапуститься.
- **Истёкшие stream URL:** yt-dlp генерирует подписанные ссылки ~на 6 часов. Для обновления: `POST /rooms/{id}/tracks/{track_id}/refresh-url`.
- **Типы WS-событий:** в проекте встречаются оба события: `track_change` и `track_changed` (legacy + новый поток). Обрабатывай оба.
- **AudioContext:** `equalizer.initialize()` нужно вызывать в обработчике пользовательского жеста (клик), иначе браузер заблокирует.
