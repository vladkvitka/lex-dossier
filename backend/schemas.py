from typing import Optional, List
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

    class Config:
        from_attributes = True


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
