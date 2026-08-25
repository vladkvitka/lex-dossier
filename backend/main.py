import os
import shutil
import uuid
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from database import Base, engine, get_db
import models
from schemas import (
    LoginRequest,
    TokenResponse,
    CategoryCreate,
    CategoryOut,
    TemplateOut,
    TemplateDetailOut,
    TemplateFieldOut,
)
from security import verify_password, create_access_token
from deps import get_current_user, require_admin
from docx_utils import extract_placeholders

Base.metadata.create_all(bind=engine)

app = FastAPI()

STORAGE_TEMPLATES_DIR = "/var/lex-dossier/storage/templates"


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


@app.get("/api/templates", response_model=List[TemplateOut])
def list_templates(
    category_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Template)
    if category_id:
        query = query.filter(models.Template.category_id == category_id)
    if current_user.role != "admin":
        query = query.filter(models.Template.status == "published")
    return query.all()


@app.get("/api/templates/{template_id}", response_model=TemplateDetailOut)
def get_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    if current_user.role != "admin" and template.status != "published":
        raise HTTPException(status_code=403, detail="Шаблон недоступен")

    fields = (
        db.query(models.TemplateField)
        .filter(models.TemplateField.template_id == template_id)
        .order_by(models.TemplateField.sort_order)
        .all()
    )
    return TemplateDetailOut(
        id=template.id,
        category_id=template.category_id,
        name=template.name,
        description=template.description,
        status=template.status,
        file_version=template.file_version,
        fields=[TemplateFieldOut.model_validate(f) for f in fields],
    )


@app.post("/api/templates", response_model=TemplateDetailOut)
def create_template(
    category_id: uuid.UUID = Form(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    if not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Файл должен быть в формате .docx")

    template_id = uuid.uuid4()
    template_dir = os.path.join(STORAGE_TEMPLATES_DIR, str(template_id))
    os.makedirs(template_dir, exist_ok=True)
    file_path = os.path.join(template_dir, "v1.docx")

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    template = models.Template(
        id=template_id,
        category_id=category_id,
        name=name,
        description=description,
        source_file_path=file_path,
        file_version=1,
        status="draft",
        created_by=current_user.id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    placeholder_keys = extract_placeholders(file_path)
    fields = []
    for index, key in enumerate(placeholder_keys):
        field = models.TemplateField(
            id=uuid.uuid4(),
            template_id=template.id,
            field_key=key,
            label=key.replace("_", " ").capitalize(),
            field_type="text",
            is_required=False,
            is_shared=False,
            sort_order=index,
        )
        db.add(field)
        fields.append(field)
    db.commit()

    return TemplateDetailOut(
        id=template.id,
        category_id=template.category_id,
        name=template.name,
        description=template.description,
        status=template.status,
        file_version=template.file_version,
        fields=[TemplateFieldOut.model_validate(f) for f in fields],
    )


@app.post("/api/templates/{template_id}/publish", response_model=TemplateOut)
def publish_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    template.status = "published"
    db.commit()
    db.refresh(template)
    return template
