"""
Разовый скрипт: добавляет колонки templates.variant_group_id (uuid,
nullable) и templates.applicant_variant (varchar, nullable) — механизм
"вариантов документа по типу заявителя" для направления СВО (например,
"Жалоба в Администрацию Президента" — один текст для военнослужащего,
другой для родственников; юрист в карточке дела видит один пункт списка
документов, система сама подставляет нужный файл по typu заявителя дела).

Существующие шаблоны не меняются — у всех обе колонки останутся пустыми,
что равносильно "у шаблона нет вариантов" (текущее поведение, ничего не
ломается).

Идемпотентен: если колонки уже есть — ничего не делает.

Запускать один раз с сервера, из папки backend, с активированным venv.
"""
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE templates ADD COLUMN IF NOT EXISTS variant_group_id UUID"))
    conn.execute(text("ALTER TABLE templates ADD COLUMN IF NOT EXISTS applicant_variant VARCHAR"))
    print("Колонки templates.variant_group_id / applicant_variant на месте.")

print("Готово.")
