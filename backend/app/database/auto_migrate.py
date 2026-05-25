"""
Лёгкие idempotent-миграции, которые применяются при старте приложения.
Добавляют новые колонки к существующим таблицам, если их там ещё нет.

Не использует Alembic, потому что проект ориентирован на быстрый dev-цикл.
Поддерживаются SQLite и PostgreSQL.
"""
from __future__ import annotations

import logging
from typing import List, Tuple

from sqlalchemy.engine import Engine
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Список миграций: (table, column, ddl_type)
# Все колонки добавляем как NULL — это самый безопасный вариант для SQLite.
ADD_COLUMNS: List[Tuple[str, str, str]] = [
    # User profile fields
    ("user", "display_name", "VARCHAR"),
    ("user", "avatar_url", "VARCHAR"),
    ("user", "bio", "TEXT"),
    ("user", "location", "VARCHAR"),
    ("user", "website", "VARCHAR"),
    ("user", "downloads_subdir", "VARCHAR"),
    # Room visuals / metadata
    ("room", "cover_url", "VARCHAR"),
    ("room", "genre", "VARCHAR"),
    ("room", "room_type", "VARCHAR DEFAULT 'public'"),
    ("room", "max_users", "INTEGER DEFAULT 50"),
    ("room", "password_hash", "VARCHAR"),
]


def _table_exists(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def _column_exists(conn, table: str, column: str) -> bool:
    columns = inspect(conn).get_columns(table)
    return any(c["name"] == column for c in columns)


def run_auto_migrations(engine: Engine) -> None:
    """Применить все миграции из ADD_COLUMNS, если они ещё не применены."""
    dialect = engine.dialect.name
    if dialect not in {"sqlite", "postgresql"}:
        logger.info("⏭  Auto-migrations skipped: unsupported dialect '%s'", dialect)
        return

    try:
        with engine.begin() as conn:
            for table, column, ddl in ADD_COLUMNS:
                if not _table_exists(conn, table):
                    logger.debug(f"⏭  table {table} not found, skipping migration")
                    continue
                if _column_exists(conn, table, column):
                    continue

                # Список миграций фиксированный (не пользовательский ввод), поэтому
                # идентификаторы можно безопасно подставлять в SQL.
                if dialect == "postgresql":
                    stmt = f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {ddl}'
                else:
                    stmt = f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}'

                logger.info(f"🛠  auto-migrate: {stmt}")
                conn.execute(text(stmt))
        logger.info("✅ Auto-migrations applied")
    except Exception as e:
        # Не валим запуск приложения, просто логируем — потом можно увидеть в стартапе
        logger.warning(f"⚠️ auto-migrate failed: {e}")
