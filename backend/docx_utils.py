import re
import docx2txt

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([а-яА-Яa-zA-Z0-9_]+)\s*\}\}")


def extract_placeholders(file_path: str):
    text = docx2txt.process(file_path)
    keys = PLACEHOLDER_PATTERN.findall(text)
    unique_keys = []
    for key in keys:
        if key not in unique_keys:
            unique_keys.append(key)
    return unique_keys
