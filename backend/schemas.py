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


class CategoryOut(BaseModel):
    id: UUID
    name: str
    branch: str
    parent_id: Optional[UUID] = None
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


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
    label: str
    field_type: str
    is_required: bool
    is_shared: bool
    shared_group_key: Optional[str] = None


class TemplateFieldsUpdateRequest(BaseModel):
    fields: List[TemplateFieldUpdate]


class TemplateOut(BaseModel):
    id: UUID
    category_id: UUID
    name: str
    description: Optional[str] = None
    status: str
    file_version: int

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

    class Config:
        from_attributes = True


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
