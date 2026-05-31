# Полный список функций и эндпоинтов проекта

Документ содержит все обнаруженные функции, HTTP endpoints и публичные JS-модули/функции, сгруппированные по файлам. Ссылка указывает на файл в рабочей области.

**Backend**

- [backend/app/main.py](backend/app/main.py)

  - `lifespan()`
  - `_register(name: str, module_path: str)`
  - `health()`
- [backend/app/database/session.py](backend/app/database/session.py)

  - `init_db()`
  - `get_db()`
- [backend/app/database/auto_migrate.py](backend/app/database/auto_migrate.py)

  - `_table_exists(conn, table: str)`
  - `_column_exists(conn, table: str, column: str)`
  - `check_schema_consistency(engine: Engine)`
  - `run_auto_migrations(engine: Engine)`
- [backend/app/domains/auth/router.py](backend/app/domains/auth/router.py)

  - `register(user_data: UserCreate)`
  - `login(login_data: UserLogin)`
  - `get_current_user_info(current_user)`
- [backend/app/domains/profiles/router.py](backend/app/domains/profiles/router.py)

  - `_backend_root()`
  - `_avatars_dir()`
  - `_save_image(upload, dest_dir, prefix)`
  - `_serialize_profile(db, user)`
  - `_serialize_track_for_profile(track, user_track)`
  - `get_my_profile()`
  - `update_my_profile(payload)`
  - `upload_avatar(file)`
  - `get_profile_by_username(username)`
  - `get_profile(user_id)`
  - `get_user_likes(user_id)`
  - `get_user_playlists(user_id)`
- [backend/app/admin/routes.py](backend/app/admin/routes.py)

  - `get_admin_user()`
  - `get_all_users()`
  - `get_all_rooms()`
  - `block_user()`
  - `unblock_user()`
  - `grant_create_rooms()`
  - `revoke_create_rooms()`
- [backend/app/player/routes.py](backend/app/player/routes.py)

  - `_sanitize_downloads_subdir(raw)`
  - `_resolve_user_downloads_dir(current_user)`
  - `get_library(skip, limit)`
  - `add_to_library(request)`
  - `add_to_library_legacy(request)`
  - `upload_local_files(files)`
  - `remove_from_library(track_id)`
  - `_ensure_user_owns_track(db, user_id, track_id)`
  - `update_track_metadata(track_id, payload)`
  - `upload_track_cover(track_id, file)`
  - `redownload_track(track_id)`
  - `play_track(request)`
  - `import_playlist(request)`
  - `get_audio_file(track_id, token, authorization, request)`
  - `file_chunk_generator(path, start, end)`
  - `get_settings_endpoint()`
  - `update_settings_endpoint(request)`
  - `search_tracks(q, source, limit)`
  - `search_soundcloud_tracks(query, limit)`
  - `search_youtube_tracks(query, limit)`
  - `get_track_detail(track_id)`
  - `validate_track_audio(track_id)`
- [backend/app/stream/router.py](backend/app/stream/router.py)

  - `stream_endpoint(room_id)` — `/stream/room/{room_id}/stream`
  - `room_status(room_id)` — `/stream/room/{room_id}/status`
  - `room_queue(room_id)` — `/stream/queue/{room_id}`
  - `room_start(room_id)` — `/stream/room/{room_id}/start` (вызывает `start_playback`)
  - `room_stop(room_id)` — `/stream/room/{room_id}/stop` (вызывает `stop_playback`)
  - `search_soundcloud(query, limit)` — proxy
- [backend/app/domains/rooms/router.py](backend/app/domains/rooms/router.py)

  - `_get_download_status(stream_url)`
  - `_serialize_room(room)`
  - `list_rooms()`
  - `list_my_rooms()`
  - `join_room()`
  - `leave_room()`
  - `list_room_users()`
  - `get_playback_state()`
  - `list_room_tracks()`
  - `add_room_track()`
  - `delete_room_track()`
  - `clear_room_tracks()`
  - `reorder_room_tracks()`
  - `get_room_lobby()`
  - `upload_room_cover()`
  - `upload_cover_unbound()`
  - `create_room()`
  - `get_room(room_id)`
  - `update_room()`
  - `delete_room()`
- [backend/app/playback/controller.py](backend/app/playback/controller.py)

  - `on_playback_event(room_id, event, data)`
  - `register_hook(callback)`
  - `unregister_hook(callback)`
  - `_get_room_lock(room_id)`
  - `get_playback_session(room_id)`
  - `_increment_generation(db, session_obj)`
  - `update_playback_session(room_id, new_state, current_queue_item_id=None, expected_end_at=None, force=False)`
  - `update_queue_state(room_track_id, new_state)`
  - `_select_ready_roomtrack(db, room_id, after_order=None, after_id=None, loop_mode=False)`
  - `ensure_track_and_asset(db, room_track, local_path, info=None)`
  - `start_playback(room_id)`
  - `next_track(room_id)`
  - `advance_playback(room_id)`
  - `set_now_playing(room_id, track_id)`
  - `stop_playback(room_id)`
  - `get_now_playing(room_id)`
  - `ensure_playback_consistency(room_id)`
  - `reconcile_queue(room_id)`
  - `playback_tick(room_id, recovery_timeout_seconds=10, max_retries=3)`
  - `_inner_advance(db, room, room_id, sess)`
  - `get_queue(room_id)`
  - `is_queue_empty(room_id)`
- [backend/app/playback/queue_service.py](backend/app/playback/queue_service.py)

  - `__init__()` (QueueService)
  - `get(room_id)`
  - `release_room(room_id)`
  - `_get_lock(room_id)`
  - `_fetch_room_and_version(db)`
  - `_increment_version(db, room)`
  - `_read_queue(db, room_id)`
  - `_track_to_dict(t)`
  - `_current_version(db, room_id)`
  - `get_queue(room_id)`
  - `add_track(...)`
  - `remove_track(room_id, queue_item_id, user_id)`
  - `move_track(...)`
  - `reorder_queue(...)`
  - `clear_queue(room_id, user_id)`
  - `get_next_track(room_id)`
  - `get_queue_size(room_id)`
  - `peek_queue(room_id, limit=5)`
- [backend/app/playback/loop.py](backend/app/playback/loop.py)

  - `__init__()`
  - `begin(room_id)`
  - `end(room_id)`
  - `is_advancing(room_id)`
  - `_make_hook()` (returns hook function)
  - `_schedule_advance(room_id)`
  - `_do_advance(room_id)`
  - `_advance_task(room_id)`
  - `_broadcast_current_track(room_id)`
  - `_loop(room_id, cancel_ev)`
  - `_safe_consistency_check(room_id)`
  - `unregister_room(room_id)`
  - `_stop_loop(room_id)`
  - `_cleanup(room_id)`
  - `_get_lock(room_id)`
  - `on_track_finished(room_id)`
  - `shutdown()`
- [backend/app/playback/timeline.py](backend/app/playback/timeline.py)

  - `get_position(now=None)`
  - `pause(now=None)`
  - `resume(now=None)`
  - `to_snapshot(now=None)`
  - `__init__()` (TrackTimeline manager)
  - `_get_async_lock(room_id)`
  - `start_track(room_id, track_id)`
  - `pause(room_id)`
  - `resume(room_id)`
  - `seek(room_id, position)`
- [backend/app/playback/sync.py](backend/app/playback/sync.py)

  - `_get_gateway()`
  - `_get_loop()`
  - `__init__()` (Sync/Heartbeater)
  - `start()`
  - `stop()`
  - `on_track_started(room_id, track_id)`
  - `on_track_paused(room_id)`
  - `on_track_resumed(room_id)`
  - `on_track_seek(room_id, position)`
  - `on_track_stopped(room_id)`
  - `get_reconnect_payload(room_id)`
  - `_heartbeat_loop()`
  - `_heartbeat_thread()`
  - `_broadcast_all_active()`
  - `_broadcast_all_sync()`
  - `_broadcast_sync(room_id, state)`
  - `_broadcast_playback_stopped(room_id)`
- [backend/app/realtime/room_gateway.py](backend/app/realtime/room_gateway.py)

  - `__init__(ws_manager=None)`
  - `_setup_playback_hooks()`
  - `on_playback(room_id, payload)`
  - `broadcast_room_state(room_id, state)`
  - `broadcast_track_change(room_id, track_id, ...)`
  - `broadcast_queue_update(room_id, queue)`
  - `broadcast_user_join(room_id, user_id, ...)`
  - `broadcast_user_leave(room_id, user_id, ...)`
  - `send_snapshot(room_id, websocket, user_role='user')`
  - `_is_duplicate(room_id, event_type, entity_id)`
  - `_fetch_track_info(track_id)`
  - `_broadcast_track_change(room_id, track_id)`
  - `_broadcast_playback_ended(room_id)`
  - `_broadcast_playback_stopped(room_id, prev_track_id)`
  - `_broadcast(room_id, msg)`
- [backend/app/services/track_service.py](backend/app/services/track_service.py)

  - `parse_url(url)`
  - `__init__(self, db)`
  - `add_track_to_library(...)`
  - `create_track_from_url(...)`
  - `refresh_stream_url(self, track)`
  - `_extract_metadata(url)`
  - `_download_audio(...)`
  - `get_user_library(user_id, skip, limit)`
  - `increment_play_count(user_id, track_id)`
  - `import_playlist(...)`
- [backend/app/services/ingest_state.py](backend/app/services/ingest_state.py)

  - `start_processing(track_id)`
  - `complete_success(track_id, local_path, media_asset_id, canonical)`
  - `mark_failure(track_id)`
  - `recover_stuck_tasks(db=None)`
- [backend/app/voice_inserts/ws_handlers.py](backend/app/voice_inserts/ws_handlers.py)

  - `handle_insert_message(...)`
- [backend/app/scripts/ingest_cli.py](backend/app/scripts/ingest_cli.py)

  - `process_track_id(tid)`
  - `run_once()`
  - `run_loop(interval)`
  - `main()`

**Frontend (public static JS + legacy)**

- [frontend/public/static/js/mock.js](frontend/public/static/js/mock.js)

  - `ok(data, status)`
  - `delay(ms)`
  - `body(raw)`
  - `now()`
  - `decodeTitle(url)`
  - `MockWebSocket` class: `constructor(url)`, `send(raw)`, `close()`, `_send(data)`
- [frontend/public/static/js/room/globals.js](frontend/public/static/js/room/globals.js)

  - `roomTrace(event, payload)`
  - `dumpRoomTrace()`
  - `escHtml(str)`
  - `formatTime(seconds)`
  - `showToast(msg, type)`
  - `authFetch(url, options)`
  - (IIFE) readRoomId()
- [frontend/public/static/js/room/websocket.js](frontend/public/static/js/room/websocket.js)

  - `WSModule.connect()`
  - `WSModule.sendWS(type, data)`
  - internal: `flushPendingMessages()`, `dispatch(msg)`, `handleRoomState(data)`, `handleTrackChange(data)`, `handleTrackChanged(msg)`, `handleThumbnailUpdated(msg)`, `updateOnlineCount(count)`, `setGlobalFromTrack(track, isPlaying)`, `startWatchdog()`, `scheduleReconnect()`, `bindLifecycleReconnect()`
- [frontend/public/static/js/room/player.js](frontend/public/static/js/room/player.js)

  - `PlayerModule.init()` (auto-initialized)
  - `PlayerModule.applyState(data)`
  - `PlayerModule.applyTrack(track, data)`
  - `PlayerModule.applyNoTrack()`
  - `PlayerModule.togglePlay()`
  - `PlayerModule.nextTrack()`
  - `PlayerModule.prevTrack()`
  - `PlayerModule.seekTo(position)`
  - `PlayerModule.seekRelative(delta)`
  - helpers: `ensureProgressTicker()`, `syncControlsByRole()`, `attachStreamAudioListeners()`, `renderArtwork(url)`, `updateProgress(pos, dur)`, `setPlayIcon(playing)`
- [frontend/public/static/js/room/stream.js](frontend/public/static/js/room/stream.js)

  - `_getOrCreateStreamAudio()`
  - `autoConnectStream()`
  - `doStop()`
  - `pauseStream()`
  - `showPlayPrompt()`
  - `onPlayPromptClick()`
  - (Legacy) `StreamModule.resolveStreamUrl(track)`
  - (Legacy) `StreamModule.assignAudio(audioEl, track, autoPlay)`
  - (Legacy) `StreamModule.stopLegacyStreamAudio()`
- [frontend/public/static/js/room/queue.js](frontend/public/static/js/room/queue.js)

  - `QueueModule.normalizeTrackMeta(track)`
  - `QueueModule.trace(step, payload)`
  - `QueueModule.setQueue(tracks)`
  - `QueueModule.render()`
  - `QueueModule.addTrack(url)`
  - `QueueModule.inferTitleFromUrl(url, fallback)`
  - `QueueModule.detectSource(url)`
  - `QueueModule.extractSourceTrackId(url)`
  - `QueueModule.removeTrack(trackId)`
  - `QueueModule.clearQueue()`
  - `QueueModule.loadQueue()`
  - `QueueModule.bindUI()`
  - `QueueModule.init()`
- [frontend/public/static/js/room/chat.js](frontend/public/static/js/room/chat.js)

  - `ChatModule.storageKey()`
  - `ChatModule.saveMessages()`
  - `ChatModule.restoreMessages()`
  - `ChatModule.setHistory(list)`
  - `ChatModule.init()`
  - `ChatModule.sendMessage()`
  - `ChatModule.appendMessage(data)`
  - `ChatModule.renderMessage(data)`
- [frontend/public/static/js/room/equalizer.js](frontend/public/static/js/room/equalizer.js)

  - `EqualizerModule.initialize(el)`
  - `EqualizerModule.setBand(idx, gainDb)`
  - `EqualizerModule.getBand(idx)`
  - `EqualizerModule.setPreset(name)`
  - `EqualizerModule.reset()`
  - `EqualizerModule.getBands()`
  - `EqualizerModule.getPresets()`
  - `EqualizerModule.isInitialized()`
- [frontend/public/static/js/room/equalizer-ui.js](frontend/public/static/js/room/equalizer-ui.js)

  - `render()`
  - `syncSliders()`
- [frontend/public/static/js/auth.js](frontend/public/static/js/auth.js)

  - `extractErrorMessage(payload, fallback)`
  - `verifyAndRedirect()`
  - `applyTheme()`
  - `autoLogin(username, password, errEl)`
  - `setLoading(btn, loading)`
- [frontend/public/static/js/room/auth-ui.js](frontend/public/static/js/room/auth-ui.js)

  - `sameOriginUrl(path)`
  - `init()`
  - `joinRoomIfAuthenticated()`
  - `leaveRoomIfAuthenticated()`
  - `loadCurrentUser()`
  - `loadRoomInfo()`
  - `loadListeners(roomOwnerId)`
  - `refreshListeners()`
  - `ensureCurrentUserInListeners(users)`
  - `renderListeners(users, ownerId)`
- [frontend/public/static/js/mock.js](frontend/public/static/js/mock.js)

  - `MockWebSocket` class and helpers (см. выше)


Сейчас быстро найду где в коде хранятся и как загружаются аватарки пользователей, чтобы дать точные ссылки и инструкции.

Searched for text `avatar` (`**/backend/app/**,frontend/**`), no results

Searched for text `avatar_url|avatar` (`**/backend/**,**/frontend/**`), no results

Read [](file:///Users/lilyaka/Downloads/Omni-Player-DEV-main/backend/app/database/models.py)

Searched for text `avatar` (`**/frontend/**`), 41 results

Read [](file:///Users/lilyaka/Downloads/Omni-Player-DEV-main/frontend/src/pages/ProfilePage.jsx#1-1), lines 1 to 260

Searched for text `static` (`**/backend/app/main.py,backend/app/**/*.py`), no results

Read [](file:///Users/lilyaka/Downloads/Omni-Player-DEV-main/backend/app/main.py)

Коротко: где хранятся аватарки, как их менять и как фронтенд их использует.

- Поле в БД: `User.avatar_url` — URL аватара (см. models.py).Файл: models.py
- Загрузка/смена аватара (HTTP): `POST /api/profiles/me/avatar` — реализовано в `_save_image` и `upload_avatar` в router.py.Файл: router.py
- Где физически сохраняются файлы: папка avatars. FastAPI раздаёт `/static/*` (см. статик-монтацию в main.py).Файл: main.py
- Как формируется публичный URL: `_save_image` возвращает `/static/uploads/avatars/{fname}` — этот URL записывается в `User.avatar_url` и возвращается в ответе API.
- Ограничения/валидация при загрузке:

  - Разрешённые расширения: `.jpg, .jpeg, .png, .webp, .gif` (параметр `ALLOWED_IMAGE_EXT` в `profiles/router.py`).
  - Максимальный размер: `MAX_IMAGE_SIZE = 5 * 1024 * 1024` (5 MB).
    Изменять эти параметры нужно в router.py.
    Файл: router.py
- Как фронтенд использует аватар:

  - Страница профиля: ProfilePage.jsx вызывает `POST /api/profiles/me/avatar` и обновляет `profile.avatar_url`, затем рендерит `<img src={profile.avatar_url} />` или показывает инициалы при отсутствии.Файл: ProfilePage.jsx
  - В других местах (sidebar, listeners, чат) используется либо `avatar_url`, либо fallback в виде первой буквы имени (см. auth-ui.js, chat.js, CSS класс `user-avatar`).
    Файлы: auth-ui.js, chat.js
- Рекомендации / примечания:

  - При замене аватара старый файл не удаляется автоматически (проверить/добавить удаление, если нужно).
  - Для единообразия можно добавить автокроп/resize на бэке при загрузке (пример: Pillow) и сохранять квадратные 200×200 версии.
  - Если хотите, могу:
    - добавить автоматическое удаление старого файла при смене аватара; или
    - добавить серверный ресайз/кроп; или
    - расширить допустимые типы/размер в `profiles/router.py`.

Что делаем дальше — добавить автокроп, удалить старые файлы при апдейте или экспортировать список текущих аватаров из avatars?

**Примечания и следующие шаги**

- Если нужно — могу расширить документ: добавить точные сигнатуры (параметры/возвращаемые значения) для каждой функции и номера строк. Сообщи, нужен ли полный signature+lines или достаточно этого инвентаря.
- Могу также сгенерировать компактный JSON-спек для фронтенда.

---

Авторы: автоматический пассивный аудит кода. Если нужен формат в другом месте — скажи, перемещу/изменю.
