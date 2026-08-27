"""
Склонение ФИО по падежам для подстановки в документы.

Использование в шаблоне .docx (админ пишет прямо в тексте Word):
  {{фио}}                      — как введено (именительный)
  {{фио|genitive}}             — родительный   (кого? чего?)
  {{фио|dative}}               — дательный     (кому? чему?)
  {{фио|accusative}}           — винительный   (кого? что?)
  {{фио|instrumental}}         — творительный  (кем? чем?)
  {{фио|prepositional}}        — предложный    (о ком? о чём?)
  {{фио|initials}}             — «Иванов И.И.» (именительный)
  {{фио|initials_dative}}      — «Иванову И.И.» и т.д. для остальных падежей:
  {{фио|initials_genitive}}, {{фио|initials_accusative}},
  {{фио|initials_instrumental}}, {{фио|initials_prepositional}}

Поле должно содержать ФИО целиком в именительном падеже, например
«Иванов Иван Иванович» — ровно так, как его вводит юрист в форме дела.

ВАЖНО: склонение — эвристическое (библиотека petrovich может ошибаться на
редких/несклоняемых фамилиях), поэтому в предпросмотре все подставленные
значения дополнительно подсвечиваются синим — юрист должен визуально
проверить результат перед генерацией итогового файла.
"""
import re
from petrovich.main import Petrovich
from petrovich.enums import Case, Gender

_petrovich = Petrovich()

_CASES = {
    "genitive": Case.GENITIVE,
    "dative": Case.DATIVE,
    "accusative": Case.ACCUSATIVE,
    "instrumental": Case.INSTRUMENTAL,
    "prepositional": Case.PREPOSITIONAL,
}


def split_full_name(full_name: str):
    parts = [p for p in (full_name or "").strip().split() if p]
    surname = parts[0] if len(parts) >= 1 else ""
    firstname = parts[1] if len(parts) >= 2 else ""
    patronymic = parts[2] if len(parts) >= 3 else ""
    return surname, firstname, patronymic


def _detect_gender(patronymic: str):
    p = (patronymic or "").lower()
    if p.endswith(("ович", "евич", "ич")):
        return Gender.MALE
    if p.endswith(("овна", "евна", "инична", "ична")):
        return Gender.FEMALE
    return None  # пусть petrovich попробует определить сам по имени/фамилии


def decline_full_name(full_name: str, case: str) -> str:
    """Склоняет полное ФИО целиком. case='nominative' (или неизвестный) —
    возвращает как есть. При любой ошибке склонения возвращает исходный
    текст, а не падает — лучше показать неизменённое имя, чем сломать
    генерацию документа."""
    case_enum = _CASES.get(case)
    if case_enum is None:
        return full_name

    surname, firstname, patronymic = split_full_name(full_name)
    if not surname:
        return full_name
    gender = _detect_gender(patronymic)

    try:
        d_surname = _petrovich.lastname(surname, case_enum, gender)
        d_firstname = _petrovich.firstname(firstname, case_enum, gender) if firstname else ""
        d_patronymic = _petrovich.middlename(patronymic, case_enum, gender) if patronymic else ""
    except Exception:
        return full_name

    return " ".join(p for p in (d_surname, d_firstname, d_patronymic) if p)


def initials_form(full_name: str, case: str = "nominative") -> str:
    """«Иванов И.И.» (фамилия склоняется по падежу, инициалы — нет)."""
    surname, firstname, patronymic = split_full_name(full_name)
    if not surname:
        return full_name

    case_enum = _CASES.get(case)
    if case_enum is not None:
        gender = _detect_gender(patronymic)
        try:
            surname = _petrovich.lastname(surname, case_enum, gender)
        except Exception:
            pass

    initials = "".join(f"{p[0].upper()}." for p in (firstname, patronymic) if p)
    return f"{surname} {initials}".strip()


# ---------- маркеры для предпросмотра (не путать с итоговым файлом) ----------
# ⟪текст⟫ — значение было подставлено из поля (подсвечивается синим)
# ⟦текст⟧ — поле не заполнено (подсвечивается красным, из preview_document)

_GAP_RE = re.compile(r"^⟦.*⟧$", re.S)
_FILLED_RE = re.compile(r"^⟪(.*)⟫$", re.S)


def _unwrap_marker(value):
    """Возвращает (чистый_текст, тип), тип: 'gap' | 'filled' | None."""
    if not isinstance(value, str):
        return value, None
    if _GAP_RE.match(value):
        return value, "gap"
    m = _FILLED_RE.match(value)
    if m:
        return m.group(1), "filled"
    return value, None


def build_clean_filters() -> dict:
    """Фильтры для итоговой генерации — возвращают чистый текст без меток."""
    filters = {}
    for case_name in _CASES:
        filters[case_name] = (lambda v, c=case_name: decline_full_name(v, c) if isinstance(v, str) else v)
        filters[f"initials_{case_name}"] = (lambda v, c=case_name: initials_form(v, c) if isinstance(v, str) else v)
    filters["initials"] = (lambda v: initials_form(v, "nominative") if isinstance(v, str) else v)
    return filters


def build_preview_filters() -> dict:
    """Те же фильтры для предпросмотра — понимают и отдают маркеры
    ⟪заполнено⟫ / ⟦пропуск⟧, чтобы фронтенд мог подсветить результат."""

    def make_case_filter(case_name):
        def f(value):
            clean, kind = _unwrap_marker(value)
            if kind == "gap":
                return value
            return f"⟪{decline_full_name(clean, case_name)}⟫"
        return f

    def make_initials_filter(case_name):
        def f(value):
            clean, kind = _unwrap_marker(value)
            if kind == "gap":
                return value
            return f"⟪{initials_form(clean, case_name)}⟫"
        return f

    filters = {}
    for case_name in _CASES:
        filters[case_name] = make_case_filter(case_name)
        filters[f"initials_{case_name}"] = make_initials_filter(case_name)
    filters["initials"] = make_initials_filter("nominative")
    return filters
