"""
Разовая миграция для этапа 1 ИИ-модуля («Лекс.Досье»).

Что делает:
  1. Добавляет колонку cases.raw_narrative (TEXT) — если её ещё нет.
  2. Создаёт таблицу ai_requests_log — если её ещё нет.
  3. Создаёт таблицу app_settings — если её ещё нет.

Скрипт ИДЕМПОТЕНТНЫЙ — его можно запускать повторно (например, по ошибке
дважды, или на нескольких окружениях): каждый шаг сначала проверяет, нужно
ли вообще что-то делать, и пропускает уже применённые изменения. Это отличие
от прошлых разовых migrate_*.py в этом проекте (которые были одноразовыми и
удалялись после применения) — сделано так специально, чтобы одним и тем же
файлом можно было накатить изменения и на прод, и на тестовое окружение, не
боясь запустить дважды.

Запуск на сервере:
    cd /var/lex-dossier/app/backend
    source venv/bin/activate   # если используется виртуальное окружение
    python migrate_ai_stage1.py

После успешного применения на проде этот файл можно (как и раньше) удалить
из репозитория и с сервера — модели в models.py уже содержат все нужные
колонки/таблицы, так что на СВЕЖЕЙ базе Base.metadata.create_all() создаст
всё верно и без этого скрипта.
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
        # 1. cases.raw_narrative
        if column_exists(conn, "cases", "raw_narrative"):
            print("[skip] cases.raw_narrative уже существует")
        else:
            conn.execute(text("ALTER TABLE cases ADD COLUMN raw_narrative TEXT"))
            print("[ok]   добавлена колонка cases.raw_narrative")

        # 2. ai_requests_log
        if table_exists(conn, "ai_requests_log"):
            print("[skip] таблица ai_requests_log уже существует")
        else:
            conn.execute(text("""
                CREATE TABLE ai_requests_log (
                    id UUID PRIMARY KEY,
                    case_id UUID NOT NULL REFERENCES cases(id),
                    request_type VARCHAR NOT NULL,
                    model_used VARCHAR,
                    prompt_tokens INTEGER,
                    completion_tokens INTEGER,
                    success BOOLEAN DEFAULT TRUE,
                    error_message TEXT,
                    raw_response TEXT,
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            print("[ok]   создана таблица ai_requests_log")

        # 3. app_settings
        if table_exists(conn, "app_settings"):
            print("[skip] таблица app_settings уже существует")
        else:
            conn.execute(text("""
                CREATE TABLE app_settings (
                    key VARCHAR PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            print("[ok]   создана таблица app_settings")

    print("Готово.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ОШИБКА миграции: {e}", file=sys.stderr)
        sys.exit(1)
