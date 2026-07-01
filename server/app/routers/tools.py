"""云端工具执行：/v1/tools/exec

Agent Loop 在前端跑，工具调用统一经这里执行（云端工具）。
本地工具（fs/shell）由 Tauri 端执行，不走这里。
"""
from __future__ import annotations

import ast
import operator
import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..deps import get_current_user
from ..models import User

router = APIRouter(prefix="/v1/tools", tags=["tools"])


# ---------------- 工具定义（schema 给前端/模型） ----------------

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "计算一个数学表达式，支持 + - * / ** % 和括号。用于精确算术。",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "数学表达式，如 (12+5)*3/2"}
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "联网搜索，返回相关网页标题、摘要和链接。用于获取实时信息、新闻、事实查询。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "count": {"type": "integer", "description": "返回结果数，默认 5", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "抓取一个网页的正文内容（纯文本）。用于阅读某个具体网址的详细内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "网页 URL，必须 http/https 开头"}
                },
                "required": ["url"],
            },
        },
    },
]


# ---------------- 执行器 ----------------

_ALLOWED_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.USub: operator.neg, ast.UAdd: operator.pos, ast.FloorDiv: operator.floordiv,
}


def _safe_eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("只支持数字")
    if isinstance(node, ast.BinOp):
        op = _ALLOWED_OPS.get(type(node.op))
        if not op:
            raise ValueError("不支持的运算符")
        return op(_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp):
        op = _ALLOWED_OPS.get(type(node.op))
        if not op:
            raise ValueError("不支持的一元运算符")
        return op(_safe_eval(node.operand))
    raise ValueError("表达式非法")


def tool_calculate(args: dict) -> str:
    expr = str(args.get("expression", "")).strip()
    if not expr:
        return "错误：空表达式"
    try:
        tree = ast.parse(expr, mode="eval")
        result = _safe_eval(tree.body)
        return f"{expr} = {result}"
    except Exception as e:
        return f"计算错误：{e}"


async def tool_web_search(args: dict) -> str:
    query = str(args.get("query", "")).strip()
    count = int(args.get("count", 5) or 5)
    count = max(1, min(count, 10))
    if not query:
        return "错误：空查询"
    # Bing 国内可达（blog 纯 IPv6 连不上 DuckDuckGo）
    from urllib.parse import quote
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            r = await client.get(
                f"https://cn.bing.com/search?q={quote(query)}&setlang=zh-CN",
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                },
            )
        html = r.text
        results = []
        # 按 b_algo 分块（每个搜索结果），取 h2>a 标题与链接
        blocks = html.split('class="b_algo"')
        for b in blocks[1:]:
            m = re.search(r'<h2[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', b, re.S)
            if not m:
                continue
            url = m.group(1)
            title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            ps = re.search(r'<p[^>]*>(.*?)</p>', b, re.S)
            snip = re.sub(r"<[^>]+>", "", ps.group(1)).strip() if ps else ""
            snip = re.sub(r"&[a-z]+;", " ", snip)
            if title:
                results.append(f"{len(results)+1}. {title}\n   {snip}\n   {url}")
            if len(results) >= count:
                break
        return "\n\n".join(results) if results else f"未找到关于「{query}」的结果"
    except Exception as e:
        return f"搜索失败：{e}"


async def tool_web_fetch(args: dict) -> str:
    url = str(args.get("url", "")).strip()
    if not url.startswith(("http://", "https://")):
        return "错误：URL 必须以 http/https 开头"
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        html = r.text
        # 去脚本/样式
        html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S)
        html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.S)
        # 取 body 文本
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"&nbsp;", " ", text)
        text = re.sub(r"&amp;", "&", text)
        text = re.sub(r"&lt;", "<", text)
        text = re.sub(r"&gt;", ">", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:4000] if text else "（页面无可提取正文）"
    except Exception as e:
        return f"抓取失败：{e}"


_EXECUTORS = {
    "calculate": tool_calculate,
    "web_search": tool_web_search,
    "web_fetch": tool_web_fetch,
}


# ---------------- 路由 ----------------

class ToolExecRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] = {}


@router.get("/schemas")
def get_schemas(user: User = Depends(get_current_user)) -> dict:
    """前端拉云端工具 schema。"""
    return {"tools": TOOL_SCHEMAS}


@router.post("/exec")
async def exec_tool(req: ToolExecRequest, user: User = Depends(get_current_user)) -> dict:
    """执行单个云端工具，返回文本结果。"""
    fn = _EXECUTORS.get(req.tool)
    if not fn:
        raise HTTPException(status_code=400, detail=f"unknown_tool:{req.tool}")
    import inspect
    try:
        if inspect.iscoroutinefunction(fn):
            result = await fn(req.arguments)
        else:
            result = fn(req.arguments)
        return {"ok": True, "result": str(result)}
    except Exception as e:
        return {"ok": False, "result": f"工具执行异常：{e}"}
