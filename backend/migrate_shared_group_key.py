"""
Разовый скрипт: добавляет колонку shared_group_key в уже существующую
таблицу template_fields. Использует настройки подключения из database.py
проекта, поэтому пароли/хосты указывать не нужно.
Запускать один раз с сервера, из папки backend, с активированным venv.
"""
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    conn.execute(text(
        "ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS shared_group_key VARCHAR"
    ))

print("Готово: колонка shared_group_key добавлена (или уже была).")
