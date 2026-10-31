FROM python:3.12.12-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 TZ=UTC
COPY worker/requirements.lock /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY worker /app/worker
RUN useradd --create-home worker
USER worker
CMD ["python","-m","worker.main"]
