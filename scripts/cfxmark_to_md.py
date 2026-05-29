#!/usr/bin/env python3
"""从 stdin 读取 Confluence storage XHTML，经 cfxmark 转为 Markdown，向 stdout 输出 JSON。"""
from __future__ import annotations

import json
import sys


def strip_surrogates(text: str) -> str:
    """去掉 lone UTF-16 surrogate（UTF-8 无法编码，会导致 json/stdout 失败）。"""
    if not text:
        return text
    return "".join("\ufffd" if 0xD800 <= ord(ch) <= 0xDFFF else ch for ch in text)


def write_json_stdout(payload: object) -> None:
    """始终按 UTF-8 写入 stdout，避免 Windows 控制台编码问题。"""
    text = strip_surrogates(json.dumps(payload, ensure_ascii=False))
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))


def write_json_stderr(payload: object) -> None:
    text = strip_surrogates(json.dumps(payload, ensure_ascii=False))
    sys.stderr.buffer.write(text.encode("utf-8", errors="replace"))


def read_stdin_text() -> str:
    raw = sys.stdin.buffer.read()
    return strip_surrogates(raw.decode("utf-8", errors="replace"))


def main() -> int:
    xhtml = read_stdin_text()
    if not xhtml.strip():
        write_json_stderr({"error": "empty input"})
        return 1

    try:
        import cfxmark
    except ImportError:
        write_json_stderr(
            {"error": "cfxmark 未安装；请使用 Python 3.10+ 执行: pip install cfxmark"},
        )
        return 2

    try:
        result = cfxmark.to_md(xhtml)
        payload = {
            "markdown": strip_surrogates(result.markdown),
            "warnings": [strip_surrogates(str(w)) for w in result.warnings],
        }
        write_json_stdout(payload)
        return 0
    except Exception as exc:  # noqa: BLE001 — CLI 边界需回传具体错误
        write_json_stderr({"error": strip_surrogates(str(exc))})
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
