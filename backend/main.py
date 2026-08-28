import os
import re
import json
import shutil
import subprocess
import tempfile
import uuid
import zipfile
import io
from typing import List, Optional, Dict

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from docxtpl import DocxTemplate
from docx import Document as DocxDocument
import jinja2

from database import Base, engine, get_db
import models
from schemas import (
    LoginRequest,
    TokenResponse,
    CategoryCreate,
    CategoryUpdate,
    CategoryOut,
    TemplateOut,
    TemplateDetailOut,
    TemplateFieldOut,
    TemplateFieldsUpdateRequest,
    TemplateFieldCreate,
    PackageCreate,
    PackageUpdate,
    PackageOut,
    PackageItemOut,
    CaseCreate,
    CaseUpdate,
    CaseOut,
    CaseDetailOut,
    CaseFieldValueOut,
    CaseDocumentOut,
    GenerateRequest,
    PreviewRequest,
    PreviewResponse,
    CaseDocumentEditRequest,
)
from security import verify_password, create_access_token
from deps import get_current_user, require_admin
from docx_utils import extract_placeholders
from name_utils import build_clean_filters, build_preview_filters

Base.metadata.create_all(bind=engine)

app = FastAPI()

STORAGE_TEMPLATES_DIR = "/var/lex-dossier/storage/templates"
STORAGE_CASES_DIR = "/var/lex-dossier/storage/cases"


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
        is_universal=data.is_universal,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@app.patch("/api/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: uuid.UUID,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    if data.name is not None:
        category.name = data.name
    if data.branch is not None:
        category.branch = data.branch
    if "parent_id" in data.model_fields_set:
        if data.parent_id == category_id:
            raise HTTPException(status_code=400, detail="Категория не может быть родителем самой себя")
        category.parent_id = data.parent_id
    if data.sort_order is not None:
        category.sort_order = data.sort_order
    if data.is_universal is not None:
        category.is_universal = data.is_universal
    db.commit()
    db.refresh(category)
    return category


def _collect_category_and_descendants(db: Session, category_id: uuid.UUID) -> List[uuid.UUID]:
    ids = [category_id]
    children = db.query(models.Category).filter(models.Category.parent_id == category_id).all()
    for child in children:
        ids.extend(_collect_category_and_descendants(db, child.id))
    return ids


@app.delete("/api/categories/{category_id}")
def delete_category(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Мягкое удаление (is_active=false), каскадом на все дочерние категории.
    Так сохраняются ссылки из уже существующих шаблонов, пакетов и дел —
    они просто перестают предлагаться для новых, но не ломаются."""
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    ids = _collect_category_and_descendants(db, category_id)
    db.query(models.Category).filter(models.Category.id.in_(ids)).update(
        {"is_active": False}, synchronize_session=False
    )
    db.commit()
    return {"status": "ok", "deactivated": [str(i) for i in ids]}


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
        doc_group=template.doc_group,
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

    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    # Группа документа больше не выбирается вручную — она однозначно
    # определяется направлением категории: "service" -> служебный,
    # СВО/гражданские -> основной.
    doc_group = "service" if category.branch == "service" else "main"

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
        doc_group=doc_group,
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
        doc_group=template.doc_group,
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


@app.delete("/api/templates/{template_id}")
def delete_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")

    used_in_packages = (
        db.query(models.TemplatePackageItem)
        .filter(models.TemplatePackageItem.template_id == template_id)
        .count()
    )
    used_in_documents = (
        db.query(models.CaseDocument)
        .filter(models.CaseDocument.template_id == template_id)
        .count()
    )
    if used_in_packages or used_in_documents:
        parts = []
        if used_in_packages:
            parts.append(f"используется в пакетах: {used_in_packages}")
        if used_in_documents:
            parts.append(f"по нему уже сгенерированы документы: {used_in_documents}")
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить шаблон — " + "; ".join(parts) +
            ". Уберите его из пакетов (сгенерированные документы удалить нельзя — это история дел клиентов).",
        )

    db.query(models.TemplateField).filter(models.TemplateField.template_id == template_id).delete()
    db.delete(template)
    db.commit()

    template_dir = os.path.join(STORAGE_TEMPLATES_DIR, str(template_id))
    if os.path.isdir(template_dir):
        try:
            shutil.rmtree(template_dir)
        except OSError:
            pass

    return {"status": "ok"}


@app.post("/api/templates/{template_id}/fields", response_model=TemplateDetailOut)
def update_template_fields(
    template_id: uuid.UUID,
    data: TemplateFieldsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Массовое обновление карты полей: тип, обязательность, is_shared и
    shared_group_key (по нему объединяются одинаковые по смыслу поля разных
    шаблонов внутри одного дела/пакета)."""
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")

    fields_by_id = {
        f.id: f
        for f in db.query(models.TemplateField).filter(models.TemplateField.template_id == template_id).all()
    }
    for upd in data.fields:
        field = fields_by_id.get(upd.id)
        if not field:
            raise HTTPException(status_code=404, detail=f"Поле {upd.id} не найдено в этом шаблоне")
        field.field_key = upd.field_key
        field.label = upd.label
        field.field_type = upd.field_type
        field.is_required = upd.is_required
        field.is_shared = upd.is_shared
        field.shared_group_key = upd.shared_group_key if upd.is_shared else None
    db.commit()

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
        doc_group=template.doc_group,
        fields=[TemplateFieldOut.model_validate(f) for f in fields],
    )


@app.post("/api/templates/{template_id}/fields/add", response_model=TemplateDetailOut)
def add_template_field(
    template_id: uuid.UUID,
    data: TemplateFieldCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Добавить поле вручную — на случай, если автоматический разбор .docx
    что-то пропустил, либо в шаблон добавили новый плейсхолдер вручную."""
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")

    max_sort = (
        db.query(models.TemplateField)
        .filter(models.TemplateField.template_id == template_id)
        .count()
    )
    field = models.TemplateField(
        id=uuid.uuid4(),
        template_id=template_id,
        field_key=data.field_key,
        label=data.label,
        field_type=data.field_type,
        is_required=data.is_required,
        is_shared=data.is_shared,
        shared_group_key=data.shared_group_key if data.is_shared else None,
        sort_order=max_sort,
    )
    db.add(field)
    db.commit()

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
        doc_group=template.doc_group,
        fields=[TemplateFieldOut.model_validate(f) for f in fields],
    )


@app.delete("/api/templates/{template_id}/fields/{field_id}", response_model=TemplateDetailOut)
def delete_template_field(
    template_id: uuid.UUID,
    field_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    field = (
        db.query(models.TemplateField)
        .filter(models.TemplateField.id == field_id, models.TemplateField.template_id == template_id)
        .first()
    )
    if not field:
        raise HTTPException(status_code=404, detail="Поле не найдено")
    db.delete(field)
    db.commit()

    template = db.query(models.Template).filter(models.Template.id == template_id).first()
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
        doc_group=template.doc_group,
        fields=[TemplateFieldOut.model_validate(f) for f in fields],
    )


# ---------- Пакеты ----------

def _package_to_out(db: Session, package: models.TemplatePackage) -> PackageOut:
    rows = (
        db.query(models.TemplatePackageItem, models.Template.name)
        .join(models.Template, models.Template.id == models.TemplatePackageItem.template_id)
        .filter(models.TemplatePackageItem.package_id == package.id)
        .order_by(models.TemplatePackageItem.sort_order)
        .all()
    )
    return PackageOut(
        id=package.id,
        category_id=package.category_id,
        name=package.name,
        is_active=package.is_active,
        items=[
            PackageItemOut(template_id=item.template_id, template_name=name, sort_order=item.sort_order)
            for item, name in rows
        ],
    )


@app.get("/api/packages", response_model=List[PackageOut])
def list_packages(
    category_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.TemplatePackage).filter(models.TemplatePackage.is_active == True)
    if category_id:
        query = query.filter(models.TemplatePackage.category_id == category_id)
    return [_package_to_out(db, p) for p in query.all()]


@app.post("/api/packages", response_model=PackageOut)
def create_package(
    data: PackageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    category = db.query(models.Category).filter(models.Category.id == data.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    package = models.TemplatePackage(
        id=uuid.uuid4(),
        category_id=data.category_id,
        name=data.name,
        is_active=True,
    )
    db.add(package)
    db.commit()
    db.refresh(package)

    for index, template_id in enumerate(data.template_ids):
        db.add(
            models.TemplatePackageItem(
                id=uuid.uuid4(),
                package_id=package.id,
                template_id=template_id,
                sort_order=index,
            )
        )
    db.commit()
    return _package_to_out(db, package)


@app.patch("/api/packages/{package_id}", response_model=PackageOut)
def update_package(
    package_id: uuid.UUID,
    data: PackageUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    package = db.query(models.TemplatePackage).filter(models.TemplatePackage.id == package_id).first()
    if not package:
        raise HTTPException(status_code=404, detail="Пакет не найден")

    if data.name is not None:
        package.name = data.name
    if data.is_active is not None:
        package.is_active = data.is_active
    if data.template_ids is not None:
        db.query(models.TemplatePackageItem).filter(
            models.TemplatePackageItem.package_id == package_id
        ).delete()
        for index, template_id in enumerate(data.template_ids):
            db.add(
                models.TemplatePackageItem(
                    id=uuid.uuid4(),
                    package_id=package_id,
                    template_id=template_id,
                    sort_order=index,
                )
            )
    db.commit()
    return _package_to_out(db, package)


@app.delete("/api/packages/{package_id}")
def delete_package(
    package_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    package = db.query(models.TemplatePackage).filter(models.TemplatePackage.id == package_id).first()
    if not package:
        raise HTTPException(status_code=404, detail="Пакет не найден")

    # У дел, ссылавшихся на этот пакет, просто снимаем ссылку —
    # сами дела и уже сгенерированные документы не трогаем.
    db.query(models.Case).filter(models.Case.package_id == package_id).update(
        {"package_id": None}, synchronize_session=False
    )
    db.query(models.TemplatePackageItem).filter(
        models.TemplatePackageItem.package_id == package_id
    ).delete()
    db.delete(package)
    db.commit()
    return {"status": "ok"}


# ---------- Дела ----------

def _case_to_detail(db: Session, case: models.Case) -> CaseDetailOut:
    field_values = (
        db.query(models.CaseFieldValue)
        .filter(models.CaseFieldValue.case_id == case.id)
        .all()
    )
    documents = (
        db.query(models.CaseDocument, models.Template.name)
        .join(models.Template, models.Template.id == models.CaseDocument.template_id)
        .filter(models.CaseDocument.case_id == case.id)
        .order_by(models.CaseDocument.generated_at)
        .all()
    )
    creator = db.query(models.User).filter(models.User.id == case.created_by).first()
    return CaseDetailOut(
        id=case.id,
        client_name=case.client_name,
        category_id=case.category_id,
        package_id=case.package_id,
        status=case.status,
        created_at=case.created_at,
        created_by_name=creator.full_name if creator else None,
        created_by_email=creator.email if creator else None,
        fields=[CaseFieldValueOut.model_validate(f) for f in field_values],
        documents=[
            CaseDocumentOut(
                id=doc.id,
                template_id=doc.template_id,
                template_name=template_name,
                has_pdf=bool(doc.pdf_file_path),
                generated_at=doc.generated_at,
            )
            for doc, template_name in documents
        ],
    )


@app.get("/api/cases", response_model=List[CaseOut])
def list_cases(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Юрист и админ пока видят все дела (спецификация не разделяет видимость
    # по автору) — если понадобится ограничить юриста только своими делами,
    # здесь нужно добавить .filter(models.Case.created_by == current_user.id)
    rows = (
        db.query(models.Case, models.User.full_name, models.User.email)
        .outerjoin(models.User, models.User.id == models.Case.created_by)
        .order_by(models.Case.created_at.desc())
        .all()
    )
    result = []
    for case, creator_name, creator_email in rows:
        item = CaseOut.model_validate(case)
        item.created_by_name = creator_name
        item.created_by_email = creator_email
        result.append(item)
    return result


@app.post("/api/cases", response_model=CaseOut)
def create_case(
    data: CaseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    category = db.query(models.Category).filter(models.Category.id == data.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    if data.package_id:
        package = db.query(models.TemplatePackage).filter(models.TemplatePackage.id == data.package_id).first()
        if not package:
            raise HTTPException(status_code=404, detail="Пакет не найден")

    case = models.Case(
        id=uuid.uuid4(),
        client_name=data.client_name,
        category_id=data.category_id,
        package_id=data.package_id,
        status="draft",
        created_by=current_user.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@app.get("/api/cases/{case_id}", response_model=CaseDetailOut)
def get_case(
    case_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")
    return _case_to_detail(db, case)


@app.patch("/api/cases/{case_id}", response_model=CaseDetailOut)
def update_case(
    case_id: uuid.UUID,
    data: CaseUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")
    if data.client_name is not None:
        case.client_name = data.client_name
    if data.status is not None:
        case.status = data.status
    db.commit()
    db.refresh(case)
    return _case_to_detail(db, case)


@app.delete("/api/cases/{case_id}")
def delete_case(
    case_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")

    # Пробуем убрать файлы сгенерированных документов с диска — best effort,
    # ошибка удаления файла не должна мешать удалению записей в базе.
    documents = db.query(models.CaseDocument).filter(models.CaseDocument.case_id == case_id).all()
    for doc in documents:
        for path in (doc.docx_file_path, doc.pdf_file_path):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

    db.query(models.CaseDocument).filter(models.CaseDocument.case_id == case_id).delete()
    db.query(models.CaseDocumentEdit).filter(models.CaseDocumentEdit.case_id == case_id).delete()
    db.query(models.CaseFieldValue).filter(models.CaseFieldValue.case_id == case_id).delete()
    db.delete(case)
    db.commit()
    return {"status": "ok"}


@app.put("/api/cases/{case_id}/fields", response_model=CaseDetailOut)
def update_case_fields(
    case_id: uuid.UUID,
    data: Dict[str, str],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Пакетное сохранение формы: тело запроса — { field_key: значение, ... }."""
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")

    for field_key, value in data.items():
        existing = (
            db.query(models.CaseFieldValue)
            .filter(
                models.CaseFieldValue.case_id == case_id,
                models.CaseFieldValue.field_key == field_key,
            )
            .first()
        )
        if existing:
            existing.value = value
        else:
            db.add(
                models.CaseFieldValue(
                    id=uuid.uuid4(),
                    case_id=case_id,
                    field_key=field_key,
                    value=value,
                )
            )
    db.commit()
    return _case_to_detail(db, case)


def _convert_to_pdf(docx_path: str, out_dir: str) -> Optional[str]:
    """Конвертирует docx в pdf через LibreOffice headless. При любой ошибке
    возвращает None — генерация docx при этом всё равно считается успешной."""
    try:
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            check=True,
            timeout=60,
            capture_output=True,
        )
        base_name = os.path.splitext(os.path.basename(docx_path))[0]
        pdf_path = os.path.join(out_dir, base_name + ".pdf")
        return pdf_path if os.path.exists(pdf_path) else None
    except Exception:
        return None


def _set_run_font(run, font_name: str = "Times New Roman"):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    run.font.name = font_name
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:eastAsia"), font_name)
    rFonts.set(qn("w:cs"), font_name)


def _normalize_font(docx_path: str, font_name: str = "Times New Roman"):
    """Принудительно приводит шрифт всего документа (включая текст,
    подставленный в плейсхолдеры) к единому шрифту — чтобы вставленные
    значения визуально не отличались от остального текста шаблона.
    При любой ошибке молча пропускает — это не должно ломать генерацию."""
    try:
        doc = DocxDocument(docx_path)

        def process(paragraphs):
            for p in paragraphs:
                for run in p.runs:
                    _set_run_font(run, font_name)

        process(doc.paragraphs)
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    process(cell.paragraphs)
        for section in doc.sections:
            process(section.header.paragraphs)
            process(section.footer.paragraphs)
        doc.save(docx_path)
    except Exception:
        pass


def _format_client_short_name(full_name: str) -> str:
    """«Иванов Иван Иванович» -> «Иванов И.И.»"""
    parts = [p for p in (full_name or "").strip().split() if p]
    if not parts:
        return "Клиент"
    surname = parts[0]
    initials = "".join(f"{p[0].upper()}." for p in parts[1:3])
    return f"{surname} {initials}".strip()


def _sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "", name).strip()
    return name or "document"


def _build_document_filename(client_name: str, template_name: str, ext: str) -> str:
    return _sanitize_filename(f"{_format_client_short_name(client_name)} {template_name}") + "." + ext


def _extract_paragraph_texts(docx_path: str) -> List[str]:
    """Текст абзацев основного тела документа (без таблиц, колонтитулов —
    для них редактирование текста пока не поддерживается)."""
    doc = DocxDocument(docx_path)
    return [p.text for p in doc.paragraphs]


def _apply_paragraph_texts(docx_path: str, texts: List[str]):
    """Записывает текст абзацев обратно в реальный .docx, стараясь сохранить
    форматирование (шрифт нормализуется отдельным шагом после). Если абзацев
    в правках больше, чем было в документе — лишние добавляются в конец по
    образцу последнего абзаца. Если меньше — оставшиеся исходные очищаются."""
    doc = DocxDocument(docx_path)
    paragraphs = doc.paragraphs
    n_original = len(paragraphs)
    n_new = len(texts)

    for i in range(min(n_original, n_new)):
        p = paragraphs[i]
        if p.runs:
            p.runs[0].text = texts[i]
            for extra in p.runs[1:]:
                extra.text = ""
        else:
            p.add_run(texts[i])

    for i in range(n_new, n_original):
        for run in paragraphs[i].runs:
            run.text = ""

    if n_new > n_original and n_original > 0:
        last_p = paragraphs[-1]
        for i in range(n_original, n_new):
            new_p = doc.add_paragraph()
            new_p.paragraph_format.alignment = last_p.paragraph_format.alignment
            run = new_p.add_run(texts[i])
            if last_p.runs:
                run.bold = last_p.runs[0].bold
                run.italic = last_p.runs[0].italic

    doc.save(docx_path)


def _get_manual_edit(db: Session, case_id: uuid.UUID, template_id: uuid.UUID):
    return (
        db.query(models.CaseDocumentEdit)
        .filter(models.CaseDocumentEdit.case_id == case_id, models.CaseDocumentEdit.template_id == template_id)
        .first()
    )


def _format_documents_list(db: Session, template_ids: List[uuid.UUID]) -> str:
    """Нумерованный список названий «основных» документов (doc_group='main')
    из переданного набора — для автоматического плейсхолдера типа
    documents_list. Названия — как в библиотеке шаблонов, без фамилии
    клиента (та добавляется только в имя скачиваемого файла)."""
    if not template_ids:
        return "—"
    templates = (
        db.query(models.Template)
        .filter(models.Template.id.in_(template_ids), models.Template.doc_group == "main")
        .all()
    )
    if not templates:
        return "—"
    order = {tid: i for i, tid in enumerate(template_ids)}
    templates.sort(key=lambda t: order.get(t.id, 0))
    return "; ".join(f"{i + 1}. {t.name}" for i, t in enumerate(templates))


@app.post("/api/cases/{case_id}/generate", response_model=List[CaseDocumentOut])
def generate_documents(
    case_id: uuid.UUID,
    data: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")

    case_field_values = {
        f.field_key: (f.value or "")
        for f in db.query(models.CaseFieldValue).filter(models.CaseFieldValue.case_id == case_id).all()
    }
    documents_list_text = _format_documents_list(db, data.template_ids)

    case_dir = os.path.join(STORAGE_CASES_DIR, str(case_id))
    os.makedirs(case_dir, exist_ok=True)

    created_docs = []
    for template_id in data.template_ids:
        template = db.query(models.Template).filter(models.Template.id == template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail=f"Шаблон {template_id} не найден")
        if current_user.role != "admin" and template.status != "published":
            raise HTTPException(status_code=403, detail=f"Шаблон {template_id} недоступен")

        template_fields = (
            db.query(models.TemplateField)
            .filter(models.TemplateField.template_id == template_id)
            .all()
        )
        # Каждому плейсхолдеру шаблона (field_key) подставляем значение дела.
        # Если поле общее (is_shared) и у него задан shared_group_key —
        # значение ищем именно по нему (так реализовано объединение
        # одинаковых по смыслу полей между разными шаблонами пакета).
        # Поле с типом documents_list — не вводится вручную, а вычисляется
        # автоматически: перечень «основных» документов, отмеченных в этом
        # же запуске генерации.
        # Если значения нет — подставляем пустую строку, чтобы docxtpl не падал.
        context = {}
        for f in template_fields:
            if f.field_type == "documents_list":
                context[f.field_key] = documents_list_text
                continue
            lookup_key = f.shared_group_key if (f.is_shared and f.shared_group_key) else f.field_key
            context[f.field_key] = case_field_values.get(lookup_key, "")

        document_id = uuid.uuid4()
        docx_path = os.path.join(case_dir, f"{document_id}.docx")

        try:
            doc = DocxTemplate(template.source_file_path)
            jinja_env = jinja2.Environment()
            jinja_env.filters.update(build_clean_filters())
            doc.render(context, jinja_env)
            doc.save(docx_path)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Не удалось сформировать документ по шаблону «{template.name}»: {e}",
            )

        # Если по этому документу есть ручные правки текста (внесённые в
        # предпросмотре) — накладываем их поверх обычной подстановки полей.
        manual_edit = _get_manual_edit(db, case_id, template_id)
        if manual_edit:
            try:
                texts = json.loads(manual_edit.paragraphs_json)
                _apply_paragraph_texts(docx_path, texts)
            except Exception:
                pass  # если что-то пошло не так — остаётся вариант с подставленными полями

        _normalize_font(docx_path)

        pdf_path = _convert_to_pdf(docx_path, case_dir)

        case_document = models.CaseDocument(
            id=document_id,
            case_id=case_id,
            template_id=template_id,
            docx_file_path=docx_path,
            pdf_file_path=pdf_path,
            generated_by=current_user.id,
        )
        db.add(case_document)
        created_docs.append((case_document, template.name))

    db.commit()

    return [
        CaseDocumentOut(
            id=doc.id,
            template_id=doc.template_id,
            template_name=name,
            has_pdf=bool(doc.pdf_file_path),
            generated_at=doc.generated_at,
        )
        for doc, name in created_docs
    ]


@app.post("/api/cases/{case_id}/preview", response_model=PreviewResponse)
def preview_document(
    case_id: uuid.UUID,
    data: PreviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Предпросмотр документа по абзацам. Если по этому документу уже
    сохранены ручные правки текста — показывает их (это и есть «текущее
    состояние» документа). Иначе строит абзацы заново по текущим значениям
    формы (возможно ещё не сохранённым), подставляя метку-пропуск вместо
    пустых полей. Ничего не пишет в базу и не создаёт файлов в хранилище,
    кроме одного временного файла для чтения абзацев."""
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")

    template = db.query(models.Template).filter(models.Template.id == data.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    if current_user.role != "admin" and template.status != "published":
        raise HTTPException(status_code=403, detail="Шаблон недоступен")

    manual_edit = _get_manual_edit(db, case_id, data.template_id)
    if manual_edit:
        return PreviewResponse(paragraphs=json.loads(manual_edit.paragraphs_json), has_manual_edit=True)

    template_fields = (
        db.query(models.TemplateField)
        .filter(models.TemplateField.template_id == data.template_id)
        .all()
    )
    selected_ids = data.selected_template_ids or [data.template_id]
    documents_list_text = _format_documents_list(db, selected_ids)

    context = {}
    for f in template_fields:
        if f.field_type == "documents_list":
            context[f.field_key] = f"⟪{documents_list_text}⟫"
            continue
        lookup_key = f.shared_group_key if (f.is_shared and f.shared_group_key) else f.field_key
        value = data.values.get(lookup_key)
        # Пустое поле — служебная метка ⟦...⟧ (подсветится красным на фронте).
        # Заполненное — метка ⟪...⟫ (подсветится синим): так лавочник видит,
        # что этот текст — результат подстановки (включая склонение через
        # фильтры |dative и т.п.), а не исходный текст шаблона, и может
        # проверить его перед генерацией. В реальный .docx эти метки не
        # попадают — там значения подставляются без обёртки (см. generate).
        context[f.field_key] = f"⟪{value}⟫" if value else f"⟦не заполнено: {f.label}⟧"

    tmp_path = None
    try:
        doc = DocxTemplate(template.source_file_path)
        jinja_env = jinja2.Environment()
        jinja_env.filters.update(build_preview_filters())
        doc.render(context, jinja_env)
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp_path = tmp.name
        doc.save(tmp_path)
        paragraphs = _extract_paragraph_texts(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось построить предпросмотр: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return PreviewResponse(paragraphs=paragraphs, has_manual_edit=False)


@app.put("/api/cases/{case_id}/documents/edit", response_model=PreviewResponse)
def save_document_edit(
    case_id: uuid.UUID,
    data: CaseDocumentEditRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Сохраняет ручную правку текста документа. Учитывается при следующей
    генерации этого документа (накладывается поверх подстановки полей)."""
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")

    existing = _get_manual_edit(db, case_id, data.template_id)
    paragraphs_json = json.dumps(data.paragraphs, ensure_ascii=False)
    if existing:
        existing.paragraphs_json = paragraphs_json
    else:
        db.add(models.CaseDocumentEdit(
            id=uuid.uuid4(),
            case_id=case_id,
            template_id=data.template_id,
            paragraphs_json=paragraphs_json,
        ))
    db.commit()
    return PreviewResponse(paragraphs=data.paragraphs, has_manual_edit=True)


@app.delete("/api/cases/{case_id}/documents/edit")
def discard_document_edit(
    case_id: uuid.UUID,
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Отменяет ручные правки — при следующем открытии документ снова
    будет собираться из значений формы."""
    db.query(models.CaseDocumentEdit).filter(
        models.CaseDocumentEdit.case_id == case_id,
        models.CaseDocumentEdit.template_id == template_id,
    ).delete()
    db.commit()
    return {"status": "ok"}


@app.get("/api/cases/{case_id}/documents/{document_id}/download")
def download_document(
    case_id: uuid.UUID,
    document_id: uuid.UUID,
    format: str = "docx",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    row = (
        db.query(models.CaseDocument, models.Case.client_name, models.Template.name)
        .join(models.Case, models.Case.id == models.CaseDocument.case_id)
        .join(models.Template, models.Template.id == models.CaseDocument.template_id)
        .filter(models.CaseDocument.id == document_id, models.CaseDocument.case_id == case_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    document, client_name, template_name = row

    if format == "pdf":
        if not document.pdf_file_path or not os.path.exists(document.pdf_file_path):
            raise HTTPException(status_code=404, detail="PDF-версия недоступна для этого документа")
        return FileResponse(
            document.pdf_file_path,
            media_type="application/pdf",
            filename=_build_document_filename(client_name, template_name, "pdf"),
        )

    if not os.path.exists(document.docx_file_path):
        raise HTTPException(status_code=404, detail="Файл документа не найден на сервере")
    return FileResponse(
        document.docx_file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=_build_document_filename(client_name, template_name, "docx"),
    )


@app.get("/api/cases/{case_id}/download-all")
def download_all_documents(
    case_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    case = db.query(models.Case).filter(models.Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Дело не найдено")

    rows = (
        db.query(models.CaseDocument, models.Template.name)
        .join(models.Template, models.Template.id == models.CaseDocument.template_id)
        .filter(models.CaseDocument.case_id == case_id)
        .order_by(models.CaseDocument.generated_at)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="У этого дела ещё нет сгенерированных документов")

    buffer = io.BytesIO()
    used_names = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc, template_name in rows:
            if not os.path.exists(doc.docx_file_path):
                continue
            base_name = _build_document_filename(case.client_name, template_name, "docx")
            final_name = base_name
            i = 2
            while final_name in used_names:
                final_name = _sanitize_filename(f"{base_name[:-5]} ({i})") + ".docx"
                i += 1
            used_names.add(final_name)
            zf.write(doc.docx_file_path, arcname=final_name)
    buffer.seek(0)

    zip_filename = _sanitize_filename(f"{_format_client_short_name(case.client_name)} - документы") + ".zip"
    from urllib.parse import quote
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(zip_filename)}"},
    )
