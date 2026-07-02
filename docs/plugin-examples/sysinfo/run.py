# -*- coding: utf-8 -*-
import os, sys, platform, shutil

def main():
    print("=== 系统信息 ===")
    print(f"操作系统 : {platform.system()} {platform.release()} ({platform.version()})")
    print(f"架构     : {platform.machine()}")
    print(f"主机名   : {platform.node()}")
    print(f"CPU 核数 : {os.cpu_count()}")
    print(f"Python   : {platform.python_version()}")
    print(f"当前目录 : {os.getcwd()}")
    try:
        total, used, free = shutil.disk_usage(os.path.expanduser("~"))
        gb = 1024**3
        print(f"磁盘(~)  : 总 {total/gb:.1f}G / 已用 {used/gb:.1f}G / 可用 {free/gb:.1f}G")
    except Exception:
        pass
    # 内存（尽量不依赖第三方库）
    try:
        if platform.system() == "Linux":
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal") or line.startswith("MemAvailable"):
                        print("内存     :", line.strip())
    except Exception:
        pass

if __name__ == "__main__":
    main()
