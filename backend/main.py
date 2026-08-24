import uuid
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session

from database import Base, engine, get_db
import models
from schemas import LoginRequest, TokenResponse, CategoryCreate, CategoryOut
from security import verify_password, create_access_token
from deps import get_current_user, require_admin

Base.metadata.create_all(bind=engine)

app = FastAPI()


@app.get("/")
def root():
    return {"status": "ok", "message": "Лекс.Досье backend работает"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Пользователь деактивирован")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, role=user.role, full_name=user.full_name)


@app.get("/api/auth/me")
def read_current_user(current_user: models.User = Depends(get_current_user)):
    return {
        "full_name": current_user.full_name,
        "email": current_user.email,
        "role": current_user.role,
    }


@app.get("/api/categories", response_model=List[CategoryOut])
def list_categories(
    branch: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Category).filter(models.Category.is_active == True)
    if branch:
        query = query.filter(models.Category.branch == branch)
    return query.order_by(models.Category.sort_order).all()


@app.post("/api/categories", response_model=CategoryOut)
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    category = models.Category(
        id=uuid.uuid4(),
        name=data.name,
        branch=data.branch,
        parent_id=data.parent_id,
        sort_order=data.sort_order,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category
