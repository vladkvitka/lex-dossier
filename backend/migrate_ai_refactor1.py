"""
Разовая миграция — переработка ИИ-модуля («Лекс.Досье») по итогам
обсуждения с заказчиком после этапов 1-4:
  - объединение "разбор простых полей" и "сбор фактов" в один запрос
    (кнопка "Разобрать дело через ИИ");
  - "составление текста" вынесено в отдельную кнопку "Собрать обстоятельства
    дела", использующую уже сохранённые факты, без повторного разбора;
  - переименование "рецептов" в "промпты" (это и есть промпты, отдельное
    слово было лишним);
  - раздельная настройка модели для каждого из двух назначений.

Что делает:
  1. Добавляет колонку cases.ai_facts (TEXT) — если её ещё нет. Хранит
     список фактов, собранных кнопкой 1, до нажатия кнопки 2.
  2. Переименовывает таблицу ai_field_recipes → ai_field_prompts и колонку
     instructions → prompt_text — если старая таблица существует и новая
     ещё не создана. Если ни старой, ни новой нет — создаёт новую с нуля
     (например, если этап 3 ещё не применялся). Если новая уже есть —
     ничего не делает.
  3. Разносит значение старой настройки "ai_extract_model" (общая на оба
     назначения) на две новые — "ai_model_analyze" и "ai_model_draft" — с
     тем же значением, чтобы после миграции ничего не переключилось
     неожиданно на модель по умолчанию. Старая запись после переноса не
     удаляется (не мешает, просто больше не используется).

Идемпотентный — можно запускать повторно.

Запуск на сервере:
    cd /var/lex-dossier/app/lex-dossier/backend
    source venv/bin/activate
    python migrate_ai_refactor1.py

Условие: миграции этапов 1-4 (migrate_ai_stage1.py, migrate_ai_stage2_3.py,
migrate_ai_stage4.py) должны быть применены раньше.
"""

import sys
from sqlalchemy import text
from database import engine


def column_exists(conn, table: str, column: str) -> bool:
    row = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = :table AND column_name = :column
    """), {"table": table, "column": column}).first()
    return row is not None


def table_exists(conn, table: str) -> bool:
    row = conn.execute(text("""
        SELECT 1 FROM information_schema.tables WHERE table_name = :table
    """), {"table": table}).first()
    return row is not None


def main():
    with engine.begin() as conn:
        # 1. cases.ai_facts
        if column_exists(conn, "cases", "ai_facts"):
            print("[skip] cases.ai_facts уже существует")
        else:
            conn.execute(text("ALTER TABLE cases ADD COLUMN ai_facts TEXT"))
            print("[ok]   добавлена колонка cases.ai_facts")

        # 2. ai_field_recipes -> ai_field_prompts
        if table_exists(conn, "ai_field_prompts"):
            print("[skip] таблица ai_field_prompts уже существует")
        elif table_exists(conn, "ai_field_recipes"):
            conn.execute(text("ALTER TABLE ai_field_recipes RENAME TO ai_field_prompts"))
            conn.execute(text("ALTER TABLE ai_field_prompts RENAME COLUMN instructions TO prompt_text"))
            print("[ok]   таблица ai_field_recipes переименована в ai_field_prompts (instructions -> prompt_text)")
        else:
            conn.execute(text("""
                CREATE TABLE ai_field_prompts (
                    group_key VARCHAR PRIMARY KEY,
                    label VARCHAR NOT NULL,
                    prompt_text TEXT NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            print("[ok]   создана таблица ai_field_prompts (ни старой, ни новой не было)")

        # 3. разнести старую настройку модели на две новые
        old_setting = conn.execute(text(
            "SELECT value FROM app_settings WHERE key = 'ai_extract_model'"
        )).first()
        if old_setting and old_setting[0]:
            for new_key in ("ai_model_analyze", "ai_model_draft"):
                exists = conn.execute(text(
                    "SELECT 1 FROM app_settings WHERE key = :key"
                ), {"key": new_key}).first()
                if exists:
                    print(f"[skip] настройка {new_key} уже существует")
                else:
                    conn.execute(text(
                        "INSERT INTO app_settings (key, value) VALUES (:key, :value)"
                    ), {"key": new_key, "value": old_setting[0]})
                    print(f"[ok]   создана настройка {new_key} = {old_setting[0]} (перенесено со старой ai_extract_model)")
        else:
            print("[skip] старой настройки ai_extract_model нет — переносить нечего (будут использованы значения по умолчанию)")

    print("Готово.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ОШИБКА миграции: {e}", file=sys.stderr)
        sys.exit(1)
