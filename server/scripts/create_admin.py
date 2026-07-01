"""Create the initial admin account."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Admin  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("username")
    p.add_argument("password")
    p.add_argument("--display", default=None)
    p.add_argument("--role", choices=["admin", "superadmin"], default="superadmin")
    args = p.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Admin).filter(Admin.username == args.username).first():
            print(f"管理员 {args.username} 已存在", file=sys.stderr)
            return 1
        a = Admin(
            username=args.username,
            password_hash=hash_password(args.password),
            display_name=args.display,
            role=args.role,
        )
        db.add(a)
        db.commit()
        print(f"✅ 创建成功：id={a.id} username={a.username} role={a.role}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
