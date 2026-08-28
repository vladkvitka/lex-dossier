"""
Разовый скрипт: добавляет колонку doc_group в templates и is_universal в
categories. Использует настройки подключения из database.py проекта.
Запускать один раз с сервера, из папки backend, с активированным venv.
"""
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    conn.execute(text(
        "ALTER TABLE templates ADD COLUMN IF NOT EXISTS doc_group VARCHAR DEFAULT 'main'"
    ))
    conn.execute(text(
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_universal BOOLEAN DEFAULT false"
    ))

print("Готово: колонки templates.doc_group и categories.is_universal добавлены (или уже были).")
