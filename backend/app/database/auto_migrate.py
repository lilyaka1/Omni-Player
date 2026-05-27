"""
Schema consistency guard — READ ONLY.
Проверяет наличие критических колонок при старте приложения.
Не выполняет ALTER TABLE (race condition risk при multiple instances).

При отсутствии колонки — FATAL EXIT (не silent failure).
"""
from __future__ import annotations

import logging
from typing import List, Tuple

from sqlalchemy.engine import Engine
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Критические колонки, которые ДОЛЖНЫ существовать
# Если какой-то нет — приложение НЕ стартует.
REQUIRED_COLUMNS: List[Tuple[str, str]] = [
    ("room", "is_playing"),
    ("room", "queue_mode"),
    ("room", "queue_version"),
    ("room_track", "queue_state"),
]


def _table_exists(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def _column_exists(conn, table: str, column: str) -> bool:
    columns = inspect(conn).get_columns(table)
    return any(c["name"] == column for c in columns)


def check_schema_consistency(engine: Engine) -> None:
    """
    Read-only schema check. При отсутствии критических колонок — fatal exit.
    
    Это заменяет run_auto_migrations():
    - Никаких ALTER TABLE при старте
    - Проверка только, не мутация
    - Fatal exit если schema не готова
    """
    dialect = engine.dialect.name
    if dialect not in {"sqlite", "postgresql"}:
        logger.info("⏭  Schema check skipped: unsupported dialect '%s'", dialect)
        return

    try:
        with engine.begin() as conn:
            for table, column in REQUIRED_COLUMNS:
                if not _table_exists(conn, table):
                    raise RuntimeError(
                        f"❌ FATAL: table '{table}' does not exist. "
                        f"Run database migrations first."
                    )
                if not _column_exists(conn, table, column):
                    raise RuntimeError(
                        f"❌ FATAL: column '{table}.{column}' is missing. "
                        f"Run manual migration: "
                        f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR;"
                    )
        logger.info("✅ Schema consistency check passed")
    except RuntimeError:
        # Fatal — перебрасываем чтобы приложение не стартовало
        raise
    except Exception as e:
        logger.warning(f"⚠️ Schema check error: {e}")


# DEPRECATED: оставлен для обратной совместимости, но больше не вызывается
def run_auto_migrations(engine: Engine) -> None:
    """Deprecated: Use check_schema_consistency() instead. No-op for safety."""
    logger.warning("⚠️ run_auto_migrations() called but is deprecated — skipping")