# -*- coding: utf-8 -*-
# 结构化 HTTP 请求插件（仅用 Python 标准库，跨平台）
import os, sys, json, urllib.request, urllib.error

def main():
    raw = os.environ.get("YT_ARGS") or sys.stdin.read() or "{}"
    try:
        args = json.loads(raw)
    except Exception as e:
        print(f"参数解析失败：{e}")
        return
    url = args.get("url", "").strip()
    if not url:
        print("缺少 url")
        return
    method = (args.get("method") or "GET").upper()
    headers = args.get("headers") or {}
    body = args.get("body")
    data = body.encode("utf-8") if isinstance(body, str) and body else None

    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(str(k), str(v))
    if data and "Content-Type" not in {k.title() for k in headers}:
        req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            print(f"HTTP {resp.status} {resp.reason}")
            print(f"Content-Type: {resp.headers.get('Content-Type','')}")
            print("---")
            print(text[:8000])
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} {e.reason}")
        print("---")
        print(text[:8000])
    except Exception as e:
        print(f"请求失败：{e}")

if __name__ == "__main__":
    main()
