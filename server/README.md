# 异想天开 服务端 (yt-api)

## 本地运行

```bash
# 进入项目
cd server

# 装依赖（用清华镜像）
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 配置
cp .env.example .env
# 编辑 .env 填入 YT_JWT_SECRET、YT_MASTER_KEY 等

# 起服务
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 文档
# http://localhost:8001/docs
```

## 创建第一个测试用户

```bash
python scripts/create_user.py alice Alice@123 --credits 1000
```

## 部署到 blog

服务器目录：`/opt/yixiang-tiankai/`
systemd unit：`/etc/systemd/system/yt-api.service`（待加）
nginx 反代：`https://blog.tczeng.top/yt-api` → `127.0.0.1:8001`
