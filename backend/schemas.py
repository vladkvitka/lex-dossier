from typing import Optional, List, Dict
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str


class CategoryCreate(BaseModel):
    name: str
    branch: str
    parent_id: Optional[UUID] = None
    sort_order: int = 0
    is_universal: bool = False


class CategoryOut(BaseModel):
    id: UUID
    name: str
    branch: str
    parent_id: Optional[UUID] = None
    sort_order: int
    is_active: bool
    is_universal: bool = False

    class Config:
        from_attributes = True


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    branch: Optional[str] = None
    parent_id: Optional[UUID] = None
    sort_order: Optional[int] = None
    is_universal: Optional[bool] = None


class TemplateFieldOut(BaseModel):
    id: UUID
    field_key: str
    label: str
    field_type: str
    is_required: bool
    is_shared: bool
    shared_group_key: Optional[str] = None

    class Config:
        from_attributes = True


class TemplateFieldUpdate(BaseModel):
    id: UUID
    field_key: str
    label: str
    field_type: str
    is_required: bool
    is_shared: bool
    shared_group_key: Optional[str] = None


class TemplateFieldsUpdateRequest(BaseModel):
    fields: List[TemplateFieldUpdate]


class TemplateFieldCreate(BaseModel):
    field_key: str
    label: str
    field_type: str = "text"
    is_required: bool = False
    is_shared: bool = False
    shared_group_key: Optional[str] = None


class TemplateOut(BaseModel):
    id: UUID
    category_id: UUID
    name: str
    description: Optional[str] = None
    status: str
    file_version: int
    doc_group: str = "main"

    class Config:
        from_attributes = True


class TemplateDetailOut(TemplateOut):
    fields: List[TemplateFieldOut] = []


# ---------- Пакеты ----------

class PackageCreate(BaseModel):
    category_id: UUID
    name: str
    template_ids: List[UUID]


class PackageUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    template_ids: Optional[List[UUID]] = None


class PackageItemOut(BaseModel):
    template_id: UUID
    template_name: str
    sort_order: int


class PackageOut(BaseModel):
    id: UUID
    category_id: UUID
    name: str
    is_active: bool
    items: List[PackageItemOut] = []


# ---------- Дела ----------

class CaseCreate(BaseModel):
    category_id: UUID
    client_name: str
    package_id: Optional[UUID] = None


class CaseOut(BaseModel):
    id: UUID
    client_name: str
    category_id: UUID
    package_id: Optional[UUID] = None
    status: str
    created_at: datetime
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None

    class Config:
        from_attributes = True


class CaseUpdate(BaseModel):
    client_name: Optional[str] = None
    status: Optional[str] = None


class CaseFieldValueOut(BaseModel):
    field_key: str
    value: Optional[str] = None

    class Config:
        from_attributes = True


class CaseDocumentOut(BaseModel):
    id: UUID
    template_id: UUID
    template_name: str
    has_pdf: bool
    generated_at: datetime

    class Config:
        from_attributes = True


class CaseDetailOut(CaseOut):
    fields: List[CaseFieldValueOut] = []
    documents: List[CaseDocumentOut] = []


class GenerateRequest(BaseModel):
    template_ids: List[UUID]


class PreviewRequest(BaseModel):
    template_id: UUID
    values: Dict[str, str] = {}
    # Полный список отмеченных для генерации шаблонов этого дела — нужен,
    # чтобы правильно посчитать плейсхолдер «Список документов» (берёт
    # только «основные» документы из этого набора).
    selected_template_ids: List[UUID] = []


class PreviewResponse(BaseModel):
    paragraphs: List[str]
    has_manual_edit: bool = False


class CaseDocumentEditRequest(BaseModel):
    template_id: UUID
    paragraphs: List[str]
