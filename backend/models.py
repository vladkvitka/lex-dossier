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
    # Вариант документа по типу заявителя (актуально только для направления
    # СВО): 'serviceman' — от лица самого военнослужащего, 'relatives' —
    # от лица родственника (жена/мать/отец/брат/сестра). Если заполнено —
    # у шаблона есть "напарник" с тем же variant_group_id и другим
    # applicant_variant; юрист в карточке дела видит такую пару как ОДИН
    # пункт списка документов — систему сама подставляет нужный файл по
    # типу заявителя дела (см. _resolve_case_templates в main.py).
    variant_group_id = Column(UUID(as_uuid=True), nullable=True)
    applicant_variant = Column(String, nullable=True)  # 'serviceman' | 'relatives' | None
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
    # Сырой текст фабулы дела, как его вставил юрист. Отдельная таблица версий
    # фабулы не заводится — не нужна: каждый вызов ИИ-разбора (см.
    # AIRequestLog ниже) сам фиксирует, какой текст фабулы использовался в
    # конкретный момент, так что история по факту уже есть через лог, без
    # риска раздувать базу отдельной версионной таблицей ради текста, который
    # обычно правится не построчно, а целиком.
    raw_narrative = Column(Text, nullable=True)
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
    is_ai_generated = Column(Boolean, default=False)
    is_confirmed_by_user = Column(Boolean, default=False)
    # Короткая цитата из фабулы/списка фактов, на основании которой ИИ
    # предложил значение — хранится здесь же (а не только в памяти браузера
    # на момент разбора), чтобы подсказка при наведении на бейдж "ИИ" была
    # видна и после перезагрузки страницы / повторного открытия дела на
    # следующий день. Очищается, как только юрист подтверждает поле вручную
    # (см. update_case_fields в main.py) — подсказка не нужна для того, что
    # уже проверено человеком.
    ai_source_snippet = Column(Text, nullable=True)
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
    до итоговой генерации. Если запись есть — при генерации берётся docx_file_path
    (уже применённый .docx, посчитанный на момент сохранения правки) — это и
    есть источник истины, а не повторный рендер шаблона с попыткой сопоставить
    абзацы по индексу задним числом (это оказалось ненадёжно: разные рендеры
    одного шаблона могут дать разное число абзацев из-за {% if %}, и правки
    по индексу разъезжались, портя документ). paragraphs_json остаётся только
    для повторного открытия редактора и подсветки — на генерацию не влияет."""
    __tablename__ = "case_document_edits"
    __table_args__ = (UniqueConstraint("case_id", "template_id", name="uq_case_doc_edit"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    template_id = Column(UUID(as_uuid=True), ForeignKey("templates.id"), nullable=False)
    paragraphs_json = Column(Text, nullable=False)  # JSON-массив строк — текст абзацев (для показа/подсветки)
    docx_file_path = Column(String, nullable=True)  # уже применённый .docx — источник истины для генерации
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AIRequestLog(Base):
    """Лог обращений к ИИ — для контроля качества извлечения и расходов на
    токены (админский экран, см. тех.спеку). Намеренно НЕ хранит полный текст
    фабулы/сканов (это уже приватные данные клиента, дублировать их в ещё
    одной таблице без необходимости — лишняя точка утечки). raw_response
    хранит только компактную сводку результата (какие поля/с какой
    уверенностью были предложены) — сами значения полей и так уже лежат в
    case_field_values, здесь достаточно того, что нужно для отладки качества
    модели, а не полного слепка личных данных."""
    __tablename__ = "ai_requests_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    request_type = Column(String, nullable=False)  # 'extract_fields' | 'draft_facts' | 'draft_narrative'
    model_used = Column(String, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    raw_response = Column(Text, nullable=True)  # JSON-строка — сводка по полям (см. докстрю выше), не сырой ответ модели целиком
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AppSetting(Base):
    """Простое хранилище настроек приложения "ключ-значение". Сейчас нужно
    для одной настройки — какая ИИ-модель OpenRouter используется в разборе
    фабулы (см. AI_MODEL_CATALOG в main.py), чтобы админ мог переключать её
    для тестирования разных моделей без правки .env и перезапуска сервиса.
    Сделано универсальной таблицей, а не отдельной колонкой где-то, чтобы не
    заводить новую сущность под каждую следующую подобную настройку."""
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AIFieldRecipe(Base):
    """"Рецепт" для составного (textarea) поля — инструкция для ИИ, что и в
    каком стиле писать в это конкретное поле (например, для поля "хронология
    обращений в мед. учреждения" рецепт объясняет модели, что нужно перечислить
    обращения в хронологическом порядке с датами и результатами, а для поля
    "обстоятельства получения травмы" — связно описать событие).

    Хранится в базе, а НЕ в коде — специально, чтобы админ мог поправить
    формулировку рецепта под конкретный шаблон без участия программиста, и
    чтобы при добавлении гражданского направления новые рецепты для его
    составных полей заводились точно так же, без переписывания кода (см.
    обсуждение архитектуры в тех.спеке, раздел про масштабирование на второе
    направление)."""
    __tablename__ = "ai_field_recipes"

    # group_key — тот же ключ, что и field_key/shared_group_key поля в
    # TemplateField: один рецепт на все шаблоны, где встречается это поле.
    group_key = Column(String, primary_key=True)
    label = Column(String, nullable=False)
    instructions = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CaseAttachment(Base):
    """Скан/фото документа, приложенного к делу (медицинская справка,
    эпикриз, отказ в направлении на ВВК и т.п.) — этап 4 ИИ-модуля.

    Хранится ОТДЕЛЬНО от сгенерированных документов дела (CaseDocument) —
    это исходники от клиента, а не результат работы юриста. Файл лежит на
    диске, путь — здесь. Содержимое НЕ дублируется в базе (в отличие от
    некоторых текстовых полей) — сканы могут быть тяжёлыми, а нужны только
    как временный источник данных для ИИ-разбора, не как постоянное
    архивное хранилище."""
    __tablename__ = "case_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=False)  # 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
    file_path = Column(String, nullable=False)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
