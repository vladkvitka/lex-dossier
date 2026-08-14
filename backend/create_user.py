import getpass
import uuid
from database import SessionLocal, Base, engine
import models
from security import hash_password

Base.metadata.create_all(bind=engine)

def main():
    full_name = input("Имя и фамилия: ").strip()
    email = input("Email: ").strip()
    password = getpass.getpass("Пароль (вводимые символы не отображаются): ")
    role = input("Роль (lawyer или admin): ").strip()

    if role not in ("lawyer", "admin"):
        print("Роль должна быть строго 'lawyer' или 'admin'. Попробуйте снова.")
        return

    db = SessionLocal()
    existing = db.query(models.User).filter(models.User.email == email).first()
    if existing:
        print(f"Пользователь с email {email} уже существует.")
        db.close()
        return

    user = models.User(
        id=uuid.uuid4(),
        full_name=full_name,
        email=email,
        password_hash=hash_password(password),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    print(f"Пользователь {email} ({role}) успешно создан.")
    db.close()

if __name__ == "__main__":
    main()
