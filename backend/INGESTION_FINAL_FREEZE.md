# INGESTION FINAL FREEZE (Omni Player)

Это «железное правило» по ingestion — сохраняется в проекте и должно применяться ко всем изменениям, касающимся pipeline загрузки треков.

## Главная идея

- Это НЕ event-driven system
- Это НЕ distributed queue
- Это НЕ FSM framework
- Это НЕ orchestration engine

Это: Postgres-backed job queue + single worker + HTTP streaming

## Допустимая архитектура

Разрешено ТОЛЬКО:

- Postgres (source of truth)
- Track table
- ingest_worker (background loop)
- простые поля статуса
- HTTP streaming endpoint
- базовый retry + recovery

## Строго запрещено

- Redis / Kafka / RabbitMQ
- Celery / RQ / Temporal
- WebSocket для ingestion
- state machine frameworks
- event bus / pub-sub
- сложные transition layers
- новые сущности кроме Track/MediaAsset
- frontend изменения
- room / TTS / FFmpeg realtime системы

## Поля Track (допустимая модель)

- `processing_status`: `processing` | `ready` | `failed`
- `processing_progress`: 0–100
- `ingest_locked`: bool
- `ingest_attempts`: int
- `ingest_started_at`: datetime

## Worker — обязателен простой линейный алгоритм

1. выбрать задачи: `processing` и `ingest_locked == false`
2. поставить lock
3. выполнить: скачать файл, сохранить в storage, создать/обновить `MediaAsset`
4. обновить: `ready` или `failed`, выставить `progress`
5. снять lock

## Recovery

- Найти записи с `ingest_locked == true` и `now - ingest_started_at > 10 минут`
- Сбросить lock и вернуть запись в `processing`

## Stream rule

- `GET /stream/{track_id}` разрешён только если `processing_status == 'ready'`, иначе возвращать `409`

## Инварианты

- Один track = одна ingestion state line в БД
- Статус всегда хранится в БД
- Worker stateless
- Frontend не влияет на ingestion
- Никаких дополнительных очередей или брокеров

## Критерии успеха

- Можно убить worker → он восстановится
- Нельзя получить два download на один track
- Нет Redis / брокеров
- Поведение объясняется SQL состоянием
- Код читается за 5 минут

---

Keep it: simple, deterministic, DB-driven, boring.

---

FINAL (posted by user):

This document is authoritative for ingestion. Do not change ingestion architecture, worker design, state fields, or recovery logic without explicit approval. Follow the hard-freeze rules in this file.
