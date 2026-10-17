# syntax=docker/dockerfile:1

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    AUTO_MIGRATE=false \
    BACKGROUND_JOBS=true \
    RUN_MODE=api \
    SHUTDOWN_GRACE_SECONDS=120 \
    STORAGE_PATH=/app/storage

WORKDIR /app
COPY requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home app \
    && mkdir -p /app/backend/data /app/storage \
    && chown app:app /app/backend/data /app/storage

COPY --chown=app:app app/ ./backend/app/

USER 10001:10001
EXPOSE 8000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=40s --start-period=30s --retries=3 \
    CMD ["python", "-m", "backend.app.healthcheck"]

CMD ["python", "-m", "backend.app.entrypoint"]
