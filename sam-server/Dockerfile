# Freetoshop SAM 2 inference server.
# Mount the local Meta clone at /sam2 (repo-root sam2/) for real Smart Select.
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -U pip \
  && pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY server.py docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV SAM_HOST=0.0.0.0 \
    SAM_PORT=8765 \
    PYTHONUNBUFFERED=1

EXPOSE 8765

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8765"]
