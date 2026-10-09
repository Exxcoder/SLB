import asyncio
from contextlib import asynccontextmanager, suppress
import logging
import os
import re
from typing import Any, Awaitable, Callable, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn

from aiogram import Bot, Dispatcher, F, BaseMiddleware
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    TelegramObject,
    WebAppInfo,
)

import database as db

# Загрузка переменных окружения
load_dotenv()

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("DutyPass")

BOT_TOKEN = os.getenv("BOT_TOKEN", "5954908959:AAEgeQxOk_zOcKmb8EQKUubtpKtz2szEn6s").strip()
BASE_WEBAPP_URL = os.getenv("BASE_WEBAPP_URL", "http://localhost:7860").rstrip("/")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "7860"))

# Инициализация бота и диспетчера
bot: Optional[Bot] = None
dp: Optional[Dispatcher] = None

if BOT_TOKEN:
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher()


# --- Aiogram Middlewares ---
class AutoRegisterGroupMemberMiddleware(BaseMiddleware):
    """
    Фоновая регистрация авторов сообщений в групповых чатах,
    если они не являются ботами и не находятся в чёрном списке.
    """

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        if isinstance(event, Message) and event.chat.type in ("group", "supergroup"):
            user = event.from_user
            if user and not user.is_bot:
                full_name = (user.full_name or user.first_name or f"Боец #{user.id}").strip()
                await db.upsert_user(
                    chat_id=event.chat.id,
                    user_id=user.id,
                    full_name=full_name,
                    username=user.username,
                )
        return await handler(event, data)


# --- Aiogram Handlers ---
if dp:
    dp.message.middleware(AutoRegisterGroupMemberMiddleware())

    def get_panel_keyboard(chat_id: int, is_group: bool) -> InlineKeyboardMarkup:
        """
        КРИТИЧНО: Telegram запрещает кнопки web_app в группах (BUTTON_TYPE_INVALID).
        В группах отправляем обычную ссылку url=..., а в ЛС — web_app=WebAppInfo(...).
        """
        target_url = f"{BASE_WEBAPP_URL}?chat_id={chat_id}"
        if is_group:
            btn = InlineKeyboardButton(text="🎖 Открыть Duty Pass", url=target_url)
        else:
            btn = InlineKeyboardButton(
                text="🎖 Открыть Duty Pass",
                web_app=WebAppInfo(url=target_url),
            )
        return InlineKeyboardMarkup(inline_keyboard=[[btn]])

    @dp.message(Command("start", "uval", "menu"))
    async def cmd_start_menu(message: Message, command: CommandObject) -> None:
        if message.from_user and message.from_user.is_bot:
            return

        chat = message.chat
        is_group = chat.type in ("group", "supergroup")

        target_chat_id = chat.id
        # Если команда вызвана в ЛС с аргументом (/start -10012345678)
        if not is_group and command.args:
            try:
                target_chat_id = int(command.args.strip())
            except ValueError:
                pass

        kb = get_panel_keyboard(target_chat_id, is_group=is_group)

        if is_group:
            text = (
                "🎖 <b>Система учёта увольнений «Duty Pass»</b>

"
                f"Рота (Чат): <code>{chat.title or chat.id}</code>
"
                "Нажмите кнопку ниже для перехода в интерактивную панель управления составом."
            )
        else:
            text = (
                "🎖 <b>Система учёта увольнений «Duty Pass»</b>

"
                "Бот оптимизирован для работы в группах роты.
"
                "Добавьте бота в чат подразделения или откройте панель по кнопке ниже."
            )

        await message.answer(text, reply_markup=kb)

    @dp.message(Command("start", "uval", "menu"))
    async def cmd_start_menu(message: Message, command: CommandObject) -> None:
        if message.from_user and message.from_user.is_bot:
            return

        chat = message.chat
        is_group = chat.type in ("group", "supergroup")

        target_chat_id = chat.id
        if not is_group and command.args:
            try:
                target_chat_id = int(command.args.strip())
            except ValueError:
                pass

        kb = get_panel_keyboard(target_chat_id, is_group=is_group)

        if is_group:
            chat_name = chat.title or str(chat.id)
            text = (
                "🎖 <b>Система учёта увольнений «Duty Pass»</b>\n\n"
                f"Рота (Чат): <code>{chat_name}</code>\n"
                "Нажмите кнопку ниже для перехода в интерактивную панель управления составом."
            )
        else:
            text = (
                "🎖 <b>Система учёта увольнений «Duty Pass»</b>\n\n"
                "Бот оптимизирован для работы в группах роты.\n"
                "Добавьте бота в чат подразделения или откройте панель по кнопке ниже."
            )

        await message.answer(text, reply_markup=kb)

    # Быстрый триггер в группе: ответ (Reply) на сообщение участника (+увал, -увал, +1 увал, и т.д.)
    UVAL_PATTERN = re.compile(
        r"^([+-])\s*(\d*)\s*(?:увал[а-яё]*|ув)$", re.IGNORECASE
    )

    @dp.message(F.reply_to_message, F.text)
    async def fast_trigger_reply(message: Message) -> None:
        if message.from_user and message.from_user.is_bot:
            return

        text = message.text.strip().lower()
        match = UVAL_PATTERN.match(text)
        if not match:
            return

        target_message = message.reply_to_message
        target_user = target_message.from_user

        if not target_user:
            return

        # Исключение ботов
        if target_user.is_bot:
            await message.reply("⚠️ Боты не могут получать или расходовать увольнения.")
            return

        chat_id = message.chat.id
        user_id = target_user.id

        # Проверка чёрного списка
        if await db.is_blacklisted(chat_id, user_id):
            await message.reply("⚠️ Боец находится в чёрном списке роты.")
            return

        sign = match.group(1)
        amount_str = match.group(2)
        amount = int(amount_str) if amount_str else 1
        delta = amount if sign == "+" else -amount

        target_name = (
            target_user.full_name or target_user.first_name or f"Боец #{target_user.id}"
        ).strip()

        # Фоново актуализируем автора цели
        await db.upsert_user(
            chat_id=chat_id,
            user_id=user_id,
            full_name=target_name,
            username=target_user.username,
        )

        res = await db.change_uval(
            chat_id=chat_id,
            user_id=user_id,
            delta=delta,
            fallback_name=target_name,
        )

        if res is None:
            await message.reply("⚠️ Не удалось применить операцию: боец в чёрном списке.")
            return

        new_count, full_name = res
        action_verb = "начислено" if delta > 0 else "списано"
        delta_sign = f"+{delta}" if delta > 0 else f"{delta}"

        msg = (
            f"🎖 <b>Учёт увольнений</b>

"
            f"Боец: <b>{full_name}</b>
"
            f"Действие: <b>{action_verb} {delta_sign}</b> ув.
"
            f"Текущий остаток: <b>{new_count}</b> ув."
        )
        await message.reply(msg)


# --- FastAPI REST API ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Жизненный цикл приложения: инициализация БД и запуск фонового polling aiogram."""
    await db.init_db()
    logger.info(f"База данных SQLite инициализирована: {db.get_db_path()}")

    polling_task = None
    if bot and dp:
        polling_task = asyncio.create_task(dp.start_polling(bot))
        logger.info("Aiogram 3.x Telegram Bot polling успешно запущен.")
    else:
        logger.warning(
            "BOT_TOKEN не задан! Бот не запущен, доступен только WebApp REST API."
        )

    yield

    if polling_task:
        polling_task.cancel()
        with suppress(asyncio.CancelledError):
            await polling_task
        if bot:
            await bot.session.close()
        logger.info("Aiogram Polling остановлен.")


app = FastAPI(
    title="Duty Pass API",
    version="1.0.0",
    description="Система учёта увольнений военнослужащих роты",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic модели запросов
class UvalChangeRequest(BaseModel):
    user_id: int = Field(..., description="ID бойца")
    chat_id: int = Field(..., description="ID группы Telegram")
    delta: int = Field(..., description="Величина изменения (+1, -1, и т.д.)")


class UserAddRequest(BaseModel):
    chat_id: int = Field(..., description="ID группы Telegram")
    full_name: str = Field(..., min_length=1, max_length=150, description="ФИО / Позывной")
    username: Optional[str] = Field(None, description="Username в Telegram (без @)")


class UserBanRequest(BaseModel):
    user_id: int = Field(..., description="ID бойца")
    chat_id: int = Field(..., description="ID группы Telegram")


class ClearLogsRequest(BaseModel):
    chat_id: int = Field(..., description="ID группы Telegram")


# 1. Получение списка пользователей чата
@app.get("/api/users")
async def get_users_endpoint(chat_id: int = Query(..., description="ID чата группы")):
    users = await db.get_users(chat_id=chat_id)
    return {"status": "ok", "chat_id": chat_id, "users": users}


# 2. Мгновенное изменение количества увалов
@app.post("/api/uval")
async def change_uval_endpoint(payload: UvalChangeRequest):
    result = await db.change_uval(
        chat_id=payload.chat_id,
        user_id=payload.user_id,
        delta=payload.delta,
    )
    if result is None:
        raise HTTPException(
            status_code=403,
            detail="Пользователь находится в чёрном списке данного подразделения.",
        )
    new_count, full_name = result
    return {
        "status": "ok",
        "user_id": payload.user_id,
        "chat_id": payload.chat_id,
        "new_count": new_count,
        "full_name": full_name,
    }


# 3. Ручное добавление бойца
@app.post("/api/users/add")
async def add_user_endpoint(payload: UserAddRequest):
    new_user = await db.add_manual_user(
        chat_id=payload.chat_id,
        full_name=payload.full_name,
        username=payload.username,
    )
    return {"status": "ok", "user": new_user}


# 4. Удаление бойца из группы
@app.delete("/api/users/{user_id}")
async def delete_user_endpoint(
    user_id: int, chat_id: int = Query(..., description="ID чата группы")
):
    await db.delete_user(chat_id=chat_id, user_id=user_id)
    return {"status": "ok", "user_id": user_id, "chat_id": chat_id}


# 5. Занесение в чёрный список (бан)
@app.post("/api/users/ban")
async def ban_user_endpoint(payload: UserBanRequest):
    await db.ban_user(chat_id=payload.chat_id, user_id=payload.user_id)
    return {"status": "ok", "user_id": payload.user_id, "chat_id": payload.chat_id}


# 6. Получение журнала действий
@app.get("/api/logs")
async def get_logs_endpoint(chat_id: int = Query(..., description="ID чата группы")):
    logs = await db.get_logs(chat_id=chat_id, limit=50)
    return {"status": "ok", "chat_id": chat_id, "logs": logs}


# 7. Очистка журнала
@app.post("/api/logs/clear")
async def clear_logs_endpoint(payload: ClearLogsRequest):
    await db.clear_logs(chat_id=payload.chat_id)
    return {"status": "ok", "chat_id": payload.chat_id}


# 8. Раздача статики Mini App
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(static_dir, "index.html"))

    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")


if __name__ == "__main__":
    logger.info(f"Запуск сервера на http://{HOST}:{PORT}")
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
