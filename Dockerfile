# BottleCo: one container = API (FastAPI) + the built React app.
# Build:  docker build -t bottleco .
# Run:    docker run -p 8000:8000 -e ANTHROPIC_API_KEY=... -e BOTTLECO_DAILY_USD=1 bottleco
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

FROM python:3.13-slim
WORKDIR /app
COPY backend/pyproject.toml backend/
COPY backend/bottleco backend/bottleco
RUN pip install --no-cache-dir ./backend fastapi==0.162.0 "uvicorn==0.54.0"
COPY data/bottleco.sqlite data/bottleco.sqlite
COPY --from=web /web/dist frontend/dist
ENV BOTTLECO_DB=/app/data/bottleco.sqlite BOTTLECO_WEB=/app/frontend/dist BOTTLECO_DAILY_USD=1.0 BOTTLECO_ASK_LIMIT=30
EXPOSE 8000
CMD ["uvicorn", "bottleco.api:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app/backend"]
