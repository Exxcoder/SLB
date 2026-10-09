# Duty Pass — Система учёта увольнений

Полнофункциональный проект учёта увольнений личного состава роты для Telegram и Telegram Mini App с изоляцией по чатам (Multi-Tenancy).

## Структура проекта
- `amvera.yml` — конфигурация для деплоя в Amvera (порт 7860, том `/data`)
- `requirements.txt` — зависимости (aiogram 3.x, FastAPI, uvicorn, aiosqlite)
- `database.py` — слой базы данных SQLite с составными ключами (user_id, chat_id)
- `main.py` — сервер FastAPI + Telegram Bot Polling
- `static/index.html` — интерфейс Mini App
- `static/style.css` — стили Apple / Glassmorphism
- `static/app.js` — клиентская логика с тактильным откликом и реактивностью
- `.env.example` — шаблон переменных окружения

## Развёртывание
1. Задайте переменные окружения в Amvera:
   - `BOT_TOKEN`: токен от @BotFather
   - `BASE_WEBAPP_URL`: публичный HTTPS URL приложения (например, https://duty-pass.amvera.io)
2. При наличии тома `/data` база данных сохранится в `/data/uvals.db`.
