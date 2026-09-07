"""
Разовая миграция для этапов 2 и 3 ИИ-модуля («Лекс.Досье»).

Что делает:
  1. Добавляет колонку case_field_values.ai_source_snippet (TEXT) — если её
     ещё нет. Хранит цитату из фабулы, на основании которой ИИ предложил
     значение простого поля (этап 2 — прозрачность/проверяемость).
  2. Создаёт таблицу ai_field_recipes — если её ещё нет. Хранит
     настраиваемые админом инструкции для составных полей (хронология,
     обстоятельства и т.п. — этап 3).

Как и migrate_ai_stage1.py, скрипт ИДЕМПОТЕНТНЫЙ — можно запускать
повторно, каждый шаг сам проверяет, нужно ли что-то делать.

Запуск на сервере:
    cd /var/lex-dossier/app/backend
    source venv/bin/activate   # если используется виртуальное окружение
    python migrate_ai_stage2_3.py

Условие: migrate_ai_stage1.py должен быть применён раньше (эта миграция не
проверяет наличие таблиц/колонок из этапа 1 — предполагается, что этап 1 уже
на сервере, раз до него дошла очередь этапов 2-3).
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
        # 1. case_field_values.ai_source_snippet
        if column_exists(conn, "case_field_values", "ai_source_snippet"):
            print("[skip] case_field_values.ai_source_snippet уже существует")
        else:
            conn.execute(text("ALTER TABLE case_field_values ADD COLUMN ai_source_snippet TEXT"))
            print("[ok]   добавлена колонка case_field_values.ai_source_snippet")

        # 2. ai_field_recipes
        if table_exists(conn, "ai_field_recipes"):
            print("[skip] таблица ai_field_recipes уже существует")
        else:
            conn.execute(text("""
                CREATE TABLE ai_field_recipes (
                    group_key VARCHAR PRIMARY KEY,
                    label VARCHAR NOT NULL,
                    instructions TEXT NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            print("[ok]   создана таблица ai_field_recipes")

    print("Готово.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ОШИБКА миграции: {e}", file=sys.stderr)
        sys.exit(1)
