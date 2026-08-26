import os
import shutil
import subprocess
import uuid
from typing import List, Optional, Dict

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from docxtpl import DocxTemplate

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
    CaseCreate,
    CaseOut,
    CaseDetailOut,
    CaseFieldValueOut,
    CaseDocumentOut,
    GenerateRequest,
)
from security import verify_password, create_access_token
from deps import get_current_user, require_admin
from docx_utils import extract_placeholders

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
    return CaseDetailOut(
        id=case.id,
        client_name=case.client_name,
        category_id=case.category_id,
        status=case.status,
        created_at=case.created_at,
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
    return db.query(models.Case).order_by(models.Case.created_at.desc()).all()


@app.post("/api/cases", response_model=CaseOut)
def create_case(
    data: CaseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    category = db.query(models.Category).filter(models.Category.id == data.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    case = models.Case(
        id=uuid.uuid4(),
        client_name=data.client_name,
        category_id=data.category_id,
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
        # Каждому полю шаблона подставляем значение дела, если оно есть,
        # иначе — пустую строку (чтобы docxtpl не падал на отсутствующей переменной).
        context = {f.field_key: case_field_values.get(f.field_key, "") for f in template_fields}

        document_id = uuid.uuid4()
        docx_path = os.path.join(case_dir, f"{document_id}.docx")

        try:
            doc = DocxTemplate(template.source_file_path)
            doc.render(context)
            doc.save(docx_path)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Не удалось сформировать документ по шаблону «{template.name}»: {e}",
            )

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


@app.get("/api/cases/{case_id}/documents/{document_id}/download")
def download_document(
    case_id: uuid.UUID,
    document_id: uuid.UUID,
    format: str = "docx",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    document = (
        db.query(models.CaseDocument)
        .filter(models.CaseDocument.id == document_id, models.CaseDocument.case_id == case_id)
        .first()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")

    if format == "pdf":
        if not document.pdf_file_path or not os.path.exists(document.pdf_file_path):
            raise HTTPException(status_code=404, detail="PDF-версия недоступна для этого документа")
        return FileResponse(
            document.pdf_file_path,
            media_type="application/pdf",
            filename=f"document_{document_id}.pdf",
        )

    if not os.path.exists(document.docx_file_path):
        raise HTTPException(status_code=404, detail="Файл документа не найден на сервере")
    return FileResponse(
        document.docx_file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"document_{document_id}.docx",
    )
