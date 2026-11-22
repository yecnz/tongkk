"""Deterministic warning checks; semantic correctness still requires a reviewer."""
import re


def inspect_summary(text, source_pages):
    warnings = []
    paragraphs = [re.sub(r'\s+', ' ', p).strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    seen = set()
    for i, paragraph in enumerate(paragraphs):
        if paragraph in seen:
            warnings.append({'code': 'REPEATED_PARAGRAPH', 'paragraph': i+1})
        seen.add(paragraph)
    if not text.strip():
        warnings.append({'code': 'EMPTY'})
    if len(re.findall(r'^\s*```', text, re.M)) % 2:
        warnings.append({'code': 'UNCLOSED_FENCE'})
    for match in re.finditer(r'\[(?:p\.|page\s*|Slide\s*)(\d+)\]', text, re.I):
        page = int(match.group(1))
        if page not in source_pages:
            warnings.append({'code': 'UNKNOWN_PAGE', 'page': page, 'offset': match.start()})
    return warnings
