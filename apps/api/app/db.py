"""Minimal SQLite access layer built on the standard library.

The API intentionally avoids an ORM: a tiny helper opens short-lived
connections and guards writes with a module level lock.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from typing import Any, Iterable, Sequence

from .config import settings

_write_lock = threading.Lock()

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tier       TEXT,
        model      TEXT,
        tokens_in  INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_usd   REAL DEFAULT 0.0,
        FOREIGN KEY (session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS usage_ledger (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT NOT NULL,
        tier       TEXT NOT NULL,
        tokens_in  INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd   REAL NOT NULL DEFAULT 0.0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS desk_secrets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tavily_ledger (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        credits    INTEGER NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS board_jobs (
        id                TEXT PRIMARY KEY,
        user_id           INTEGER NOT NULL,
        kind              TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'queued',
        payload_json      TEXT NOT NULL DEFAULT '{}',
        result_json       TEXT NOT NULL DEFAULT '{}',
        notify_session_id INTEGER,
        error             TEXT,
        created_at        TEXT NOT NULL,
        started_at        TEXT,
        finished_at       TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS desk_notices (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        job_id     TEXT,
        kind       TEXT NOT NULL DEFAULT 'job',
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        read       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS brains (
        id          TEXT PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        device_id   TEXT,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS brain_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        brain_id   TEXT NOT NULL,
        title      TEXT NOT NULL DEFAULT 'profile',
        body       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (brain_id) REFERENCES brains (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS device_memory (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
)

#: Columns added after a table first shipped, as ``(table, column, definition)``.
#: ``init_db`` adds whichever are missing, so older boards keep their data.
_ADDED_COLUMNS = (
    ("chat_sessions", "pinned", "INTEGER NOT NULL DEFAULT 0"),
    # Manual order: lower comes first. New sessions take the top slot.
    ("chat_sessions", "position", "INTEGER"),
    # Last activity, for the "recent" sort.
    ("chat_sessions", "updated_at", "TEXT"),
)


def database_path() -> str:
    """Translate ``DATABASE_URL`` into a filename usable by ``sqlite3``."""

    url = settings.database_url or "sqlite:///./data/metadesk.db"
    for prefix in ("sqlite:///", "sqlite://"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return url


def connect() -> sqlite3.Connection:
    """Open a connection, creating the parent directory if necessary."""

    path = database_path()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    """Create the schema. Safe to call on every startup."""

    with _write_lock:
        connection = connect()
        try:
            for statement in _SCHEMA:
                connection.execute(statement)
            for table, column, definition in _ADDED_COLUMNS:
                present = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
                if column not in present:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            # Sessions from before manual ordering keep their newest-first order.
            connection.execute("UPDATE chat_sessions SET position = -id WHERE position IS NULL")
            connection.commit()
        finally:
            connection.close()


def execute(sql: str, params: Sequence[Any] = ()) -> tuple[int | None, int]:
    """Run a write statement and return ``(lastrowid, rowcount)``."""

    with _write_lock:
        connection = connect()
        try:
            cursor = connection.execute(sql, params)
            connection.commit()
            return cursor.lastrowid, cursor.rowcount
        finally:
            connection.close()


def fetchall(sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    """Return every row of a query as a list of dictionaries."""

    connection = connect()
    try:
        return [dict(row) for row in connection.execute(sql, params).fetchall()]
    finally:
        connection.close()


def fetchone(sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    """Return the first row of a query, or ``None``."""

    connection = connect()
    try:
        row = connection.execute(sql, params).fetchone()
        return dict(row) if row is not None else None
    finally:
        connection.close()


def executemany(sql: str, params: Iterable[Sequence[Any]]) -> None:
    """Run a write statement for many parameter tuples."""

    with _write_lock:
        connection = connect()
        try:
            connection.executemany(sql, params)
            connection.commit()
        finally:
            connection.close()
