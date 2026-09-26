# ============================================================
#  Бот для синхронизации данных автосервиса
#  Принимает данные от Mini App и отдаёт их обратно.
#  Работает на Render.com с фиктивным веб-сервером.
# ============================================================

import asyncio
import json
import os
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiohttp import web

# ---------- НАСТРОЙКИ ----------
# Токен берётся из переменной окружения BOT_TOKEN (задаётся на Render)
BOT_TOKEN = os.environ.get("BOT_TOKEN")

# URL вашего приложения на GitHub Pages
WEBAPP_URL = "https://raining0man.github.io/autoservice-app/"

# Файл, где хранится последний сохранённый бэкап
DATA_FILE = "autoservice_backup.json"

# ---------- Инициализация ----------
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# ============================================================
#  ФИКТИВНЫЙ ВЕБ-СЕРВЕР ДЛЯ RENDER
#  Render ожидает, что приложение слушает порт. Без этого он
#  считает сервис неактивным и останавливает его.
# ============================================================
async def handle(request):
    return web.Response(text="Bot is alive")

async def start_web_server():
    app = web.Application()
    app.router.add_get('/', handle)
    runner = web.AppRunner(app)
    await runner.setup()
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f"✅ Веб-сервер запущен на порту {port}")


# ---------- Команда /start ----------
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """Отправляет кнопку для открытия Mini App."""
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🔧 Открыть Автосервис",
                    web_app=WebAppInfo(url=WEBAPP_URL)
                )
            ]
        ]
    )
    await message.answer(
        "Добро пожаловать в админ-панель автосервиса!\n\n"
        "Нажмите кнопку ниже, чтобы открыть приложение.",
        reply_markup=keyboard
    )


# ---------- Обработка данных от Mini App ----------
@dp.message(F.web_app_data)
async def handle_webapp_data(message: types.Message):
    """Сюда приходят данные из Mini App через tg.sendData()."""
    try:
        data = json.loads(message.web_app_data.data)
        action = data.get("action")

        if action == "save":
            content = data.get("content", "{}")

            with open(DATA_FILE, "w", encoding="utf-8") as f:
                f.write(content)

            document = types.FSInputFile(DATA_FILE, filename="autoservice_backup.json")
            await message.answer_document(
                document=document,
                caption=f"💾 Сохранено. Версия: {data.get('version', '?')}"
            )
            await message.answer("✅ Данные сохранены. Теперь их можно загрузить на другом устройстве.")

        elif action == "load":
            if os.path.exists(DATA_FILE):
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    content = f.read()

                await message.answer(
                    f"📥 Последние сохранённые данные:\n\n{content}"
                )
                await message.answer(
                    "Скопируйте текст выше и вставьте его в приложении."
                )
            else:
                await message.answer("❌ Нет сохранённых данных. Сначала сохраните что-нибудь.")

        else:
            await message.answer(f"⚠️ Неизвестное действие: {action}")

    except json.JSONDecodeError:
        await message.answer("❌ Ошибка: неверный формат данных")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {str(e)}")


# ---------- Команда /backup ----------
@dp.message(Command("backup"))
async def cmd_backup(message: types.Message):
    """Отправляет последний сохранённый бэкап."""
    if os.path.exists(DATA_FILE):
        document = types.FSInputFile(DATA_FILE, filename="autoservice_backup.json")
        await message.answer_document(
            document=document,
            caption="📦 Последний сохранённый бэкап"
        )
    else:
        await message.answer("❌ Бэкапов пока нет.")


# ---------- Запуск ----------
async def main():
    print("🤖 Бот запущен...")
    # Запускаем веб-сервер (нужен для Render)
    await start_web_server()
    # Запускаем polling бота
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
