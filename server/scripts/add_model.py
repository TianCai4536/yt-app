"""Register/update an upstream model (encrypts the API key).

Usage:
  python scripts/add_model.py \
    --key doubao-pro --name "豆包 Pro" --provider ark \
    --url https://ark.cn-beijing.volces.com/api/v3 \
    --upstream-model doubao-pro-32k \
    --api-key sk-xxx --rate 1.0 [--grant alice,bob]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.crypto import encrypt  # noqa: E402
from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Model, User, UserModel  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--key", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--provider", required=True)
    p.add_argument("--url", required=True)
    p.add_argument("--upstream-model", required=True)
    p.add_argument("--api-key", required=True)
    p.add_argument("--rate", type=float, default=1.0)
    p.add_argument("--context", type=int, default=None)
    p.add_argument("--grant", default="", help="逗号分隔的 username，给这些用户授权")
    args = p.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        m = db.query(Model).filter(Model.model_key == args.key).first()
        if m:
            m.display_name = args.name
            m.provider = args.provider
            m.upstream_url = args.url
            m.upstream_model = args.upstream_model
            m.api_key_enc = encrypt(args.api_key)
            m.credit_rate = args.rate
            m.context_window = args.context
            print(f"♻️  更新模型 {args.key}")
        else:
            m = Model(
                model_key=args.key, display_name=args.name, provider=args.provider,
                upstream_url=args.url, upstream_model=args.upstream_model,
                api_key_enc=encrypt(args.api_key), credit_rate=args.rate,
                context_window=args.context,
            )
            db.add(m)
            print(f"✅ 新增模型 {args.key}")
        db.flush()

        for uname in [u.strip() for u in args.grant.split(",") if u.strip()]:
            user = db.query(User).filter(User.username == uname).first()
            if not user:
                print(f"  ⚠️  用户 {uname} 不存在，跳过授权")
                continue
            exists = db.query(UserModel).filter(
                UserModel.user_id == user.id, UserModel.model_id == m.id
            ).first()
            if not exists:
                db.add(UserModel(user_id=user.id, model_id=m.id))
                print(f"  🔑 授权 {uname} → {args.key}")
        db.commit()
        print("done")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
