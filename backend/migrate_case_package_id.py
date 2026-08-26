"""
Разовый скрипт: добавляет колонку package_id в уже существующую таблицу
cases (нужна для этапа "Пакеты шаблонов"). Использует настройки подключения
из database.py проекта — пароли/хосты указывать не нужно.
Запускать один раз с сервера, из папки backend, с активированным venv.
"""
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    conn.execute(text(
        "ALTER TABLE cases ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES template_packages(id)"
    ))

print("Готово: колонка cases.package_id добавлена (или уже была).")
