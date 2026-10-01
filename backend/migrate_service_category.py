"""
Разовый скрипт: создаёт (или включает обратно) системную категорию "Служебные"
(branch='service', is_universal=True) и привязывает к ней служебные шаблоны.
Отличие от прежней версии: если категория уже есть, но была отключена
(is_active=false), скрипт теперь включает её обратно.
Запускать один раз с сервера, из папки backend, с активированным venv.
"""
import uuid
from sqlalchemy import text
from database import engine

with engine.begin() as conn:
    row = conn.execute(text("SELECT id, is_active FROM categories WHERE branch = 'service' LIMIT 1")).fetchone()
    if row:
        service_id = str(row[0])
        was_active = bool(row[1])
        conn.execute(
            text("UPDATE categories SET is_universal = true, is_active = true WHERE id = :id"),
            {"id": service_id},
        )
        if was_active:
            print(f"Категория «Служебные» уже есть и включена ({service_id}). Менять ничего не пришлось.")
        else:
            print(f"Категория «Служебные» была отключена — включил её обратно ({service_id}).")
    else:
        service_id = str(uuid.uuid4())
        conn.execute(text("""
            INSERT INTO categories (id, name, branch, parent_id, sort_order, is_active, is_universal)
            VALUES (:id, 'Служебные', 'service', NULL, 0, true, true)
        """), {"id": service_id})
        print(f"Категории «Служебные» не было — создал новую ({service_id}).")

    result = conn.execute(text("""
        UPDATE templates SET category_id = :service_id
        WHERE doc_group = 'service' AND category_id != :service_id
    """), {"service_id": service_id})
    print(f"Служебных шаблонов перенесено в эту категорию: {result.rowcount}")

print("Готово.")
