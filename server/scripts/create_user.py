"""Quick CLI to create users (run inside venv).

Usage:
  python scripts/create_user.py alice Alice@123 --credits 1000
  python scripts/create_user.py bob Bob@123 --display "Bob" --credits 500 --models doubao-pro,gpt-4o
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/create_user.py` from server/ dir
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Model, User, UserModel  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("username")
    p.add_argument("password")
    p.add_argument("--display", default=None)
    p.add_argument("--email", default=None)
    p.add_argument("--credits", type=int, default=0)
    p.add_argument("--models", default="", help="逗号分隔的 model_key 列表")
    args = p.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == args.username).first():
            print(f"用户 {args.username} 已存在", file=sys.stderr)
            return 1

        u = User(
            username=args.username,
            password_hash=hash_password(args.password),
            display_name=args.display,
            email=args.email,
            credits=args.credits,
        )
        db.add(u)
        db.flush()

        for key in [k.strip() for k in args.models.split(",") if k.strip()]:
            m = db.query(Model).filter(Model.model_key == key).first()
            if not m:
                print(f"  ⚠️  模型 {key} 不存在，跳过")
                continue
            db.add(UserModel(user_id=u.id, model_id=m.id))

        db.commit()
        print(f"✅ 创建成功：id={u.id} username={u.username} credits={u.credits}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
