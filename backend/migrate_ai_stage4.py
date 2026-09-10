"""
Разовая миграция для этапа 4 ИИ-модуля («Лекс.Досье») — сканы документов.

Что делает:
  1. Создаёт таблицу case_attachments — если её ещё нет.

Идемпотентный, как и предыдущие migrate_ai_*.py — можно запускать повторно.

Запуск на сервере:
    cd /var/lex-dossier/app/lex-dossier/backend
    source venv/bin/activate
    python migrate_ai_stage4.py

Условие: миграции этапов 1-3 (migrate_ai_stage1.py, migrate_ai_stage2_3.py)
должны быть применены раньше.
"""

import sys
from sqlalchemy import text
from database import engine


def table_exists(conn, table: str) -> bool:
    row = conn.execute(text("""
        SELECT 1 FROM information_schema.tables WHERE table_name = :table
    """), {"table": table}).first()
    return row is not None


def main():
    with engine.begin() as conn:
        if table_exists(conn, "case_attachments"):
            print("[skip] таблица case_attachments уже существует")
        else:
            conn.execute(text("""
                CREATE TABLE case_attachments (
                    id UUID PRIMARY KEY,
                    case_id UUID NOT NULL REFERENCES cases(id),
                    original_filename VARCHAR NOT NULL,
                    content_type VARCHAR NOT NULL,
                    file_path VARCHAR NOT NULL,
                    uploaded_by UUID REFERENCES users(id),
                    uploaded_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            print("[ok]   создана таблица case_attachments")

    print("Готово.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ОШИБКА миграции: {e}", file=sys.stderr)
        sys.exit(1)
