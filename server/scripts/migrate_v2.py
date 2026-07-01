"""Idempotent ALTER migrations for SQLite (add columns introduced after v1)."""
from __future__ import annotations

import sqlite3
import sys


def col_exists(cur, table, col) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())


def table_exists(cur, table) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None


def main(db_path: str):
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    changes = []

    if table_exists(cur, "users") and not col_exists(cur, "users", "settings"):
        cur.execute("ALTER TABLE users ADD COLUMN settings TEXT")
        changes.append("users.settings")

    if table_exists(cur, "admins") and not col_exists(cur, "admins", "email"):
        cur.execute("ALTER TABLE admins ADD COLUMN email VARCHAR(128)")
        changes.append("admins.email")

    if table_exists(cur, "users") and not col_exists(cur, "users", "token_residual"):
        cur.execute("ALTER TABLE users ADD COLUMN token_residual FLOAT NOT NULL DEFAULT 0")
        changes.append("users.token_residual")

    con.commit()
    con.close()
    print("migrated:", changes if changes else "nothing to do")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "yt.db")
