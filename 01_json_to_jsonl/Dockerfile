FROM python:3.12-slim

WORKDIR /app

# 文字化け/ログ周り
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

# 変換スクリプトをコンテナへ
COPY app.py /app.py

# デフォルト実行（docker compose側で上書きもOK）
ENTRYPOINT ["python", "/app.py"]
