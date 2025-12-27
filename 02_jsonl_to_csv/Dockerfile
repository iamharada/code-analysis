FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

COPY app.py /app.py

ENTRYPOINT ["python", "/app.py"]
