"""
Разовый скрипт: добавляет колонку cases.first_generated_at (timestamptz,
nullable), которой раньше не было в модели Case. Она нужна для новой
логики статусов дела:
  - draft — до первого нажатия "Сгенерировать документы";
  - in_progress — после первого нажатия (first_generated_at проставляется
    в этот момент);
  - archived — автоматически, через 4 рабочих дня после first_generated_at
    (проверяется лениво, на каждом чтении дела, без отдельного крона).

Идемпотентен: если колонка уже есть — ничего не делает, скрипт можно
запускать повторно без вреда.

Запускать один раз с сервера, из папки backend, с активированным venv.
"""
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS first_generated_at TIMESTAMPTZ"))
    print("Колонка cases.first_generated_at на месте (создана или уже существовала).")

print("Готово.")
