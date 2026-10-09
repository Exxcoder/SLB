import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import aiosqlite


def get_db_path() -> str:
    """Определяет путь к базе данных SQLite с учётом персистентного тома Amvera (/data)."""
    custom_path = os.getenv("DB_PATH")
    if custom_path:
        return custom_path
    if os.path.exists("/data") and os.path.isdir("/data"):
        return "/data/uvals.db"
    return "./uvals.db"


DB_PATH = get_db_path()


async def init_db() -> None:
    """Инициализация таблиц базы данных и необходимых индексов."""
    db_file = get_db_path()
    parent_dir = os.path.dirname(db_file)
    if parent_dir and not os.path.exists(parent_dir):
        os.makedirs(parent_dir, exist_ok=True)

    async with aiosqlite.connect(db_file) as db:
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA foreign_keys = ON;")

        # 1. Таблица бойцов (пользователей) роты с составным ключом (user_id, chat_id)
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER,
                chat_id INTEGER,
                full_name TEXT NOT NULL,
                username TEXT,
                uval_count INTEGER DEFAULT 0,
                max_limit INTEGER DEFAULT 5,
                PRIMARY KEY (user_id, chat_id)
            );
            """
        )

        # 2. Черный список (blacklist) - изолирован по chat_id
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS blacklist (
                user_id INTEGER,
                chat_id INTEGER,
                created_at TEXT,
                PRIMARY KEY (user_id, chat_id)
            );
            """
        )

        # 3. Журнал действий (logs) - изолирован по chat_id
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                full_name TEXT NOT NULL,
                delta INTEGER NOT NULL,
                new_count INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

        # Индексы для быстрой фильтрации по chat_id в multi-tenant среде
        await db.execute("CREATE INDEX IF NOT EXISTS idx_users_chat ON users (chat_id);")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_blacklist_chat ON blacklist (chat_id);")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_logs_chat ON logs (chat_id);")

        await db.commit()


async def is_blacklisted(chat_id: int, user_id: int) -> bool:
    """Проверяет, находится ли пользователь в чёрном списке конкретного чата."""
    async with aiosqlite.connect(get_db_path()) as db:
        async with db.execute(
            "SELECT 1 FROM blacklist WHERE chat_id = ? AND user_id = ?;",
            (chat_id, user_id),
        ) as cursor:
            row = await cursor.fetchone()
            return row is not None


async def upsert_user(
    chat_id: int, user_id: int, full_name: str, username: Optional[str] = None
) -> bool:
    """
    Фоновая регистрация или обновление бойца.
    Если боец в чёрном списке чата — запись строго игнорируется.
    """
    if await is_blacklisted(chat_id, user_id):
        return False

    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO users (user_id, chat_id, full_name, username, uval_count, max_limit)
            VALUES (?, ?, ?, ?, 0, 5)
            ON CONFLICT (user_id, chat_id) DO UPDATE SET
                full_name = excluded.full_name,
                username = COALESCE(excluded.username, users.username);
            """,
            (user_id, chat_id, full_name.strip(), username),
        )
        await db.commit()
        return True


async def get_users(chat_id: int) -> List[Dict[str, Any]]:
    """Получение списка бойцов группы, исключая забаненных."""
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT u.user_id, u.chat_id, u.full_name, u.username, u.uval_count, u.max_limit
            FROM users u
            WHERE u.chat_id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM blacklist b
                  WHERE b.user_id = u.user_id AND b.chat_id = u.chat_id
              )
            ORDER BY u.uval_count DESC, u.full_name ASC;
            """,
            (chat_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_user(chat_id: int, user_id: int) -> Optional[Dict[str, Any]]:
    """Получение одного бойца чата."""
    if await is_blacklisted(chat_id, user_id):
        return None

    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT user_id, chat_id, full_name, username, uval_count, max_limit
            FROM users
            WHERE chat_id = ? AND user_id = ?;
            """,
            (chat_id, user_id),
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def change_uval(
    chat_id: int, user_id: int, delta: int, fallback_name: Optional[str] = None
) -> Optional[Tuple[int, str]]:
    """
    Изменяет счётчик увалов бойца (MAX(0, count + delta)) и логирует действие.
    Возвращает кортеж (новый_счетчик, имя_бойца) либо None, если боец забанен.
    """
    if await is_blacklisted(chat_id, user_id):
        return None

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row

        async with db.execute(
            "SELECT full_name, uval_count FROM users WHERE chat_id = ? AND user_id = ?;",
            (chat_id, user_id),
        ) as cursor:
            row = await cursor.fetchone()

        if row:
            full_name = row["full_name"]
            curr_count = row["uval_count"]
        else:
            full_name = fallback_name.strip() if fallback_name else f"Боец #{abs(user_id)}"
            curr_count = 0
            await db.execute(
                """
                INSERT INTO users (user_id, chat_id, full_name, username, uval_count, max_limit)
                VALUES (?, ?, ?, NULL, 0, 5);
                """,
                (user_id, chat_id, full_name),
            )

        new_count = max(0, curr_count + delta)

        await db.execute(
            "UPDATE users SET uval_count = ? WHERE chat_id = ? AND user_id = ?;",
            (new_count, chat_id, user_id),
        )

        await db.execute(
            """
            INSERT INTO logs (chat_id, user_id, full_name, delta, new_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (chat_id, user_id, full_name, delta, new_count, now_str),
        )

        await db.commit()
        return new_count, full_name


async def add_manual_user(
    chat_id: int, full_name: str, username: Optional[str] = None
) -> Dict[str, Any]:
    """
    Ручное добавление бойца через WebApp.
    Генерирует отрицательный user_id для исключения конфликтов с Telegram ID.
    """
    clean_name = full_name.strip()
    clean_username = username.strip().lstrip("@") if username else None

    async with aiosqlite.connect(get_db_path()) as db:
        async with db.execute(
            "SELECT MIN(user_id) FROM users WHERE chat_id = ? AND user_id < 0;",
            (chat_id,),
        ) as cursor:
            row = await cursor.fetchone()
            min_id = row[0] if row and row[0] is not None else 0

        new_user_id = min_id - 1 if min_id < 0 else -1

        await db.execute(
            """
            INSERT INTO users (user_id, chat_id, full_name, username, uval_count, max_limit)
            VALUES (?, ?, ?, ?, 0, 5);
            """,
            (new_user_id, chat_id, clean_name, clean_username),
        )
        await db.commit()

        return {
            "user_id": new_user_id,
            "chat_id": chat_id,
            "full_name": clean_name,
            "username": clean_username,
            "uval_count": 0,
            "max_limit": 5,
        }


async def delete_user(chat_id: int, user_id: int) -> bool:
    """Удаляет бойца из группы и очищает связанные записи в журнале этой группы."""
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM users WHERE chat_id = ? AND user_id = ?;",
            (chat_id, user_id),
        )
        await db.execute(
            "DELETE FROM logs WHERE chat_id = ? AND user_id = ?;",
            (chat_id, user_id),
        )
        await db.commit()
        return True


async def ban_user(chat_id: int, user_id: int) -> bool:
    """Заносит бойца в чёрный список чата и удаляет его из списка пользователей."""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO blacklist (user_id, chat_id, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT (user_id, chat_id) DO NOTHING;
            """,
            (user_id, chat_id, now_str),
        )
        await db.execute(
            "DELETE FROM users WHERE chat_id = ? AND user_id = ?;",
            (chat_id, user_id),
        )
        await db.commit()
        return True


async def get_logs(chat_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    """Возвращает последние N записей журнала для указанного чата."""
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, chat_id, user_id, full_name, delta, new_count, created_at
            FROM logs
            WHERE chat_id = ?
            ORDER BY id DESC
            LIMIT ?;
            """,
            (chat_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def clear_logs(chat_id: int) -> bool:
    """Очищает журнал действий только для указанного чата."""
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM logs WHERE chat_id = ?;", (chat_id,))
        await db.commit()
        return True


async def get_top_stats(chat_id: int, limit: int = 15) -> List[Dict[str, Any]]:
    """Получение топа бойцов по увалам для команды /stats."""
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT u.user_id, u.full_name, u.username, u.uval_count, u.max_limit
            FROM users u
            WHERE u.chat_id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM blacklist b
                  WHERE b.user_id = u.user_id AND b.chat_id = u.chat_id
              )
            ORDER BY u.uval_count DESC, u.full_name ASC
            LIMIT ?;
            """,
            (chat_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
