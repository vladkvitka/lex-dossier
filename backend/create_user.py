import sys
import uuid
from database import SessionLocal, Base, engine
import models
from security import hash_password

Base.metadata.create_all(bind=engine)

def create_user(full_name, email, password, role):
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
    if len(sys.argv) != 5:
        print('Использование: python create_user.py "Имя Фамилия" email пароль роль(lawyer|admin)')
        sys.exit(1)
    create_user(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
