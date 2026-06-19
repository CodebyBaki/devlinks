# backend/Dockerfile

# ── Stage 1: Builder ──────────────────────────────────────────
# We use a full Python image to install dependencies
FROM python:3.11-slim AS builder

# Set working directory inside the container
WORKDIR /app

# Copy only requirements first — Docker caches this layer
# If requirements.txt hasn't changed, Docker skips pip install on rebuild
# This is one of the most important Dockerfile optimizations
COPY requirements.txt .

# Install dependencies into a specific folder we can copy later
RUN pip install --no-cache-dir --prefix=/install \
    --default-timeout=120 \
    --retries 5 \
    -r requirements.txt

# ── Stage 2: Runtime ──────────────────────────────────────────
# Start fresh from the same slim image — no build tools, smaller image
FROM python:3.11-slim

WORKDIR /app

# Copy installed packages from builder stage
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Tell Docker this container listens on port 8000
EXPOSE 8000

# The command that runs when the container starts
# --host 0.0.0.0 means accept connections from outside the container
# Without this it only accepts connections from inside the container itself
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]