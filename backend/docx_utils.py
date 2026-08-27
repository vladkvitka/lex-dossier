import re
import docx2txt

# Ключ плейсхолдера — те же символы, что и раньше. После него может идти
# необязательный Jinja-фильтр вида |dative, |genitive, |initials и т.п.
# (используется для склонения ФИО — см. name_utils.py). Для списка полей
# нас интересует только сам ключ, фильтр в field_key не попадает: одно и то
# же поле «фио» может встречаться в документе и как {{фио}}, и как
# {{фио|dative}} — это всё то же самое поле, юрист заполняет его один раз.
PLACEHOLDER_PATTERN = re.compile(
    r"\{\{\s*([а-яА-Яa-zA-Z0-9_]+)(?:\s*\|[^}]*)?\s*\}\}"
)


def extract_placeholders(file_path: str):
    text = docx2txt.process(file_path)
    keys = PLACEHOLDER_PATTERN.findall(text)
    unique_keys = []
    for key in keys:
        if key not in unique_keys:
            unique_keys.append(key)
    return unique_keys
