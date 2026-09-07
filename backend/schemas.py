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
    variant_group_id: Optional[UUID] = None
    applicant_variant: Optional[str] = None

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
    # Кто заявитель — актуально только для направления "СВО" (branch='svo').
    # Один и тот же набор шаблонов СВО пишется один раз с условной логикой
    # ({% if %} по этому полю внутри .docx), а не дублируется на 6 шаблонов
    # под каждого родственника. Для гражданских дел не используется.
    applicant_type: Optional[str] = None


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
    raw_narrative: Optional[str] = None


class CaseFieldValueOut(BaseModel):
    field_key: str
    value: Optional[str] = None
    is_ai_generated: bool = False
    is_confirmed_by_user: bool = False
    ai_source_snippet: Optional[str] = None

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
    # Шаблоны из пакета дела, уже разрешённые под конкретное дело — если
    # среди них есть варианты по типу заявителя (см. Template.variant_group_id),
    # тут уже стоит нужный конкретный template_id, а не оба варианта сразу.
    package_template_ids: List[UUID] = []
    raw_narrative: Optional[str] = None


class GenerateRequest(BaseModel):
    template_ids: List[UUID]


class PreviewRequest(BaseModel):
    template_id: UUID
    values: Dict[str, str] = {}
    # Полный список отмеченных для генерации шаблонов этого дела — нужен,
    # чтобы правильно посчитать плейсхолдер «Список документов» (берёт
    # только «основные» документы из этого набора).
    selected_template_ids: List[UUID] = []


class ParagraphOut(BaseModel):
    text: str
    align: str = "left"  # 'left' | 'center' | 'right' | 'justify' — как в исходном .docx


class DocBlockOut(BaseModel):
    """Один блок тела документа для отображения В ПОЛНОМ ВИДЕ (абзацы И
    таблицы, в том порядке, в котором они реально идут в файле) — только
    для чтения. type == "paragraph": используются text/align. type ==
    "table": используется rows (список строк, каждая — список текстов
    ячеек). Правка текста по-прежнему работает только с обычными абзацами
    (см. ParagraphOut/paragraphs ниже) — таблицы в редакторе не
    редактируются, только показываются такими, какие они есть."""
    type: str  # "paragraph" | "table"
    text: Optional[str] = None
    align: Optional[str] = None
    rows: Optional[List[List[str]]] = None


class PreviewResponse(BaseModel):
    paragraphs: List[ParagraphOut]
    has_manual_edit: bool = False
    blocks: List[DocBlockOut] = []


class CaseDocumentEditRequest(BaseModel):
    template_id: UUID
    paragraphs: List[str]
    # Текущие значения полей формы (как в PreviewRequest) — нужны, чтобы на
    # сервере отрендерить ТОТ ЖЕ САМЫЙ документ, что сейчас видит юрист в
    # редакторе, и применить правки прямо к нему (а не к какому-то другому
    # рендеру, полученному позже — из-за этого раньше расходилось число
    # абзацев и документ портился).
    values: Dict[str, str] = {}
    selected_template_ids: List[UUID] = []


# ---------- ИИ-разбор фабулы (этап 1: только текст, только простые поля) ----------

class ExtractFieldsRequest(BaseModel):
    # Если не передан — берётся уже сохранённый case.raw_narrative. Если
    # передан — им же обновляется case.raw_narrative (разбор одновременно
    # сохраняет текст, чтобы юрист не терял его при случайном обновлении
    # страницы до нажатия отдельной кнопки "сохранить").
    raw_narrative: Optional[str] = None
    # Список выбранных для дела шаблонов — по ним определяется, какие именно
    # простые поля сейчас нужны (те же шаблоны, что отмечены галочками в
    # карточке дела).
    template_ids: List[UUID]


class ExtractedFieldResult(BaseModel):
    field_key: str
    label: str
    value: str
    confidence: str  # 'high' | 'low'
    source_snippet: Optional[str] = None
    applied: bool
    skipped_reason: Optional[str] = None  # 'confirmed_by_user' | 'empty' | None


class ExtractFieldsResponse(BaseModel):
    results: List[ExtractedFieldResult] = []
    model_used: str


# ---------- Настройка ИИ-модели (админ) ----------

class AiModelInfo(BaseModel):
    slug: str                    # идентификатор модели в OpenRouter, напр. "anthropic/claude-haiku-4.5"
    provider: str                # "Anthropic" | "OpenAI" | "DeepSeek" | "Google"
    label: str                   # человекочитаемое имя для интерфейса
    price_in_per_million: float  # $ за 1 млн входных токенов
    price_out_per_million: float # $ за 1 млн выходных токенов
    estimated_cost_per_call: float  # расчётная стоимость ОДНОГО обращения к /ai/extract-fields при типичном объёме фабулы
    note: Optional[str] = None
    is_current: bool = False


class AiSettingsOut(BaseModel):
    current_model: str
    models: List[AiModelInfo]


class AiSettingsUpdate(BaseModel):
    model: str


# ---------- Лог ИИ-запросов (админ, этап 2 — прозрачность) ----------

class AiRequestLogOut(BaseModel):
    id: UUID
    case_id: UUID
    case_client_name: Optional[str] = None
    request_type: str
    model_used: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    success: bool
    error_message: Optional[str] = None
    created_at: datetime
    created_by_name: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Рецепты составных полей (админ, этап 3) ----------

class AIFieldRecipeOut(BaseModel):
    group_key: str
    label: str
    instructions: Optional[str] = None  # None — рецепт ещё не задан, будет использован общий запасной вариант
    has_recipe: bool = False

    class Config:
        from_attributes = True


class AIFieldRecipeUpdate(BaseModel):
    instructions: str


# ---------- ИИ-черновик составных полей (этап 3: хронология, обстоятельства и т.п.) ----------

class DraftFieldsRequest(BaseModel):
    raw_narrative: Optional[str] = None
    template_ids: List[UUID]


class FactItemOut(BaseModel):
    date: Optional[str] = None
    event: str


class DraftedFieldResult(BaseModel):
    field_key: str
    label: str
    draft: str
    applied: bool
    skipped_reason: Optional[str] = None  # 'confirmed_by_user' | 'empty' | None
    used_generic_recipe: bool = False  # True — для этого поля ещё не настроен рецепт админом


class DraftFieldsResponse(BaseModel):
    results: List[DraftedFieldResult] = []
    facts: List[FactItemOut] = []  # собранные факты — для прозрачности, можно показать юристу отдельно
    model_used: str
