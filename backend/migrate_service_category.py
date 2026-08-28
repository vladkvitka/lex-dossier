"""
Разовый скрипт: создаёт системную категорию "Служебные" (branch='service',
is_universal=True) — единственную категорию в этом направлении, категорий
внутри неё больше не создаётся, все служебные шаблоны прикрепляются прямо
к ней. Заодно переносит туда уже существующие шаблоны с doc_group='service',
которые в предыдущей версии интерфейса могли быть прикреплены к обычным
категориям СВО/гражданские.
Запускать один раз с сервера, из папки backend, с активированным venv.
"""
import uuid
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    row = conn.execute(text("SELECT id FROM categories WHERE branch = 'service' LIMIT 1")).fetchone()
    if row:
        service_id = str(row[0])
        conn.execute(text("UPDATE categories SET is_universal = true WHERE id = :id"), {"id": service_id})
        print(f"Системная категория «Служебные» уже существует ({service_id})")
    else:
        service_id = str(uuid.uuid4())
        conn.execute(text("""
            INSERT INTO categories (id, name, branch, parent_id, sort_order, is_active, is_universal)
            VALUES (:id, 'Служебные', 'service', NULL, 0, true, true)
        """), {"id": service_id})
        print(f"Создана системная категория «Служебные» ({service_id})")

    result = conn.execute(text("""
        UPDATE templates SET category_id = :service_id
        WHERE doc_group = 'service' AND category_id != :service_id
    """), {"service_id": service_id})
    print(f"Перенесено служебных шаблонов в системную категорию: {result.rowcount}")

print("Готово.")
