# -*- coding: utf-8 -*-
import os, sys, json, hashlib

def main():
    raw = os.environ.get("YT_ARGS") or sys.stdin.read() or "{}"
    try:
        args = json.loads(raw)
    except Exception as e:
        print(f"参数解析失败：{e}")
        return
    algo = (args.get("algo") or "sha256").lower()
    if algo not in ("md5", "sha1", "sha256"):
        print(f"不支持的算法：{algo}")
        return
    h = hashlib.new(algo)
    if args.get("file"):
        path = args["file"]
        try:
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
            print(f"{algo}({path}) = {h.hexdigest()}")
        except Exception as e:
            print(f"读取文件失败：{e}")
    elif args.get("text") is not None:
        h.update(str(args["text"]).encode("utf-8"))
        print(f"{algo}(text) = {h.hexdigest()}")
    else:
        print("请提供 text 或 file")

if __name__ == "__main__":
    main()
