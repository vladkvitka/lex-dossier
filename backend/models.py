import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Category(Base):
    __tablename__ = "categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    branch = Column(String, nullable=False)
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    # Шаблоны из "общей" категории доступны при сборке пакета/дела для ЛЮБОЙ
    # другой категории (например категория "Общие" с актом сдачи-приёмки).
    is_universal = Column(Boolean, default=False)


class Template(Base):
    __tablename__ = "templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    source_file_path = Column(String, nullable=False)
    file_version = Column(Integer, default=1)
    status = Column(String, default="draft")
    # "main" — основные документы (результат услуги: иски, ходатайства, жалобы),
    # "service" — служебные (договор на оказание услуг, акты и т.п.)
    doc_group = Column(String, default="main")
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TemplateField(Base):
    __tablename__ = "template_fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("templates.id"), nullable=False)
    field_key = Column(String, nullable=False)
    label = Column(String, nullable=False)
    field_type = Column(String, default="text")
    is_required = Column(Boolean, default=False)
    is_shared = Column(Boolean, default=False)
    # Ключ группировки одинаковых по смыслу shared-полей между разными шаблонами
    # (например {{ФИО_истца}} в одном шаблоне и {{ФИО_доверителя}} в другом —
    # оба со shared_group_key="фио_доверителя" будут одним полем в форме дела).
    # Пока не используется в логике генерации — задел под этап "Пакеты".
    shared_group_key = Column(String, nullable=True)
    sort_order = Column(Integer, default=0)


class TemplatePackage(Base):
    """Пакет документов: набор шаблонов, которые типично идут вместе для категории."""
    __tablename__ = "template_packages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)


class TemplatePackageItem(Base):
    __tablename__ = "template_package_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    package_id = Column(UUID(as_uuid=True), ForeignKey("template_packages.id"), nullable=False)
    template_id = Column(UUID(as_uuid=True), ForeignKey("templates.id"), nullable=False)
    sort_order = Column(Integer, default=0)


class Case(Base):
    """Дело клиента — набор данных, из которых генерируются документы."""
    __tablename__ = "cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_name = Column(String, nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    package_id = Column(UUID(as_uuid=True), ForeignKey("template_packages.id"), nullable=True)
    raw_narrative = Column(Text, nullable=True)  # сырой текст фабулы — задел под этап ИИ
    status = Column(String, default="draft")  # draft | in_progress | ready | archived
    # Момент первого нажатия "Сгенерировать документы". До него статус
    # всегда draft. От него отсчитываются 4 рабочих дня до авто-архивации.
    first_generated_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CaseFieldValue(Base):
    """Значение одного поля внутри конкретного дела (общее для всех документов дела)."""
    __tablename__ = "case_field_values"
    __table_args__ = (UniqueConstraint("case_id", "field_key", name="uq_case_field"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    field_key = Column(String, nullable=False)
    value = Column(Text, nullable=True)
    is_ai_generated = Column(Boolean, default=False)      # задел под этап ИИ
    is_confirmed_by_user = Column(Boolean, default=False)  # задел под этап ИИ
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CaseDocument(Base):
    """Сгенерированный документ конкретного дела."""
    __tablename__ = "case_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    template_id = Column(UUID(as_uuid=True), ForeignKey("templates.id"), nullable=False)
    docx_file_path = Column(String, nullable=False)
    pdf_file_path = Column(String, nullable=True)  # NULL, если конвертация в PDF не удалась
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    generated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class CaseDocumentEdit(Base):
    """Ручные правки текста документа (по абзацам), внесённые в предпросмотре
    до итоговой генерации. Если запись есть — при генерации текст абзацев
    берётся отсюда, поверх обычной подстановки полей."""
    __tablename__ = "case_document_edits"
    __table_args__ = (UniqueConstraint("case_id", "template_id", name="uq_case_doc_edit"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    template_id = Column(UUID(as_uuid=True), ForeignKey("templates.id"), nullable=False)
    paragraphs_json = Column(Text, nullable=False)  # JSON-массив строк — текст абзацев
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
