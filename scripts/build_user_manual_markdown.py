from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "output" / "AQLI_WhatsApp_Chatbot_User_Manual.docx"
OUTPUT = ROOT / "output" / "AQLI_WhatsApp_Chatbot_User_Manual.md"


def iter_blocks(document):
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def paragraph_num_id(paragraph):
    p_pr = paragraph._p.pPr
    if p_pr is None or p_pr.numPr is None or p_pr.numPr.numId is None:
        return None
    return int(p_pr.numPr.numId.val)


def has_shading(paragraph):
    p_pr = paragraph._p.pPr
    return p_pr is not None and p_pr.find(qn("w:shd")) is not None


def escape_cell(text):
    return text.strip().replace("|", "\\|").replace("\n", "<br>")


def table_to_markdown(table):
    rows = [[escape_cell(cell.text) for cell in row.cells] for row in table.rows]
    if not rows:
        return []
    width = len(rows[0])
    lines = ["| " + " | ".join(rows[0]) + " |"]
    lines.append("| " + " | ".join(["---"] * width) + " |")
    for row in rows[1:]:
        normalized = row[:width] + [""] * max(0, width - len(row))
        lines.append("| " + " | ".join(normalized) + " |")
    return lines


def callout_to_markdown(text):
    if ":" not in text:
        return f"> {text}"
    label, body = text.split(":", 1)
    return f"> **{label.strip()}:**{body}"


def build_markdown():
    document = Document(INPUT)
    lines = []
    counters = {}
    seen_title = False
    code_open = False

    def ensure_blank():
        if lines and lines[-1] != "":
            lines.append("")

    def close_code():
        nonlocal code_open
        if code_open:
            lines.extend(["```", ""])
            code_open = False

    for block in iter_blocks(document):
        if isinstance(block, Table):
            close_code()
            ensure_blank()
            lines.extend(table_to_markdown(block))
            lines.append("")
            continue

        text = block.text.strip()
        if not text:
            continue

        style = block.style.name if block.style is not None else ""

        if style == "Code Block":
            if not code_open:
                ensure_blank()
                lines.append("```text")
                code_open = True
            lines.append(text)
            continue

        close_code()

        if not seen_title and text == "AQLI WhatsApp Chatbot":
            ensure_blank()
            lines.extend(["# AQLI WhatsApp Chatbot", ""])
            seen_title = True
            continue
        if text == "Professional User and Administrator Manual":
            lines.extend(["*Professional User and Administrator Manual*", ""])
            continue
        if text.startswith("Version 1.0") or text.startswith("Production application:"):
            lines.extend([text, ""])
            continue
        if text.startswith("WhatsApp chatbot:") or text.startswith("Prepared for"):
            lines.extend([text, ""])
            continue

        if style == "Heading 1":
            ensure_blank()
            lines.extend([f"## {text}", ""])
            continue
        if style == "Heading 2":
            ensure_blank()
            lines.extend([f"### {text}", ""])
            continue
        if style == "Heading 3":
            ensure_blank()
            lines.extend([f"#### {text}", ""])
            continue

        num_id = paragraph_num_id(block)
        if num_id == 21:
            lines.append(f"- {text}")
            continue
        if num_id is not None and 22 <= num_id <= 30:
            counters[num_id] = counters.get(num_id, 0) + 1
            lines.append(f"{counters[num_id]}. {text}")
            continue

        if has_shading(block):
            ensure_blank()
            lines.extend([callout_to_markdown(text), ""])
            continue

        ensure_blank()
        lines.extend([text, ""])

    close_code()
    content = "\n".join(lines).rstrip() + "\n"
    OUTPUT.write_text(content, encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    build_markdown()
