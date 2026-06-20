# Docker — Containerization

This document covers turning the two local services into containers, wiring them together with Docker Compose, and the secrets-handling decisions made along the way.

## Why Containerize at All

The application worked perfectly on one laptop. Containerizing it solves the actual production problem: "make this run identically anywhere" — a teammate's machine, a cloud VM, a Kubernetes cluster. A Dockerfile is a recipe; building it produces an image; running that image produces a container that behaves the same regardless of host.

## Backend Dockerfile — Multi-Stage Build

```dockerfile
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install \
    --default-timeout=120 --retries 5 \
    -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Why two stages:** the builder stage needs `pip` and any build tooling required by dependencies. The runtime stage copies only the installed packages and app code — no build tools end up in the final image, keeping it smaller and reducing attack surface.

**`--default-timeout=120 --retries 5`:** added after the initial build failed with a `ReadTimeoutError` from PyPI under a slow/unstable network connection. Increasing pip's timeout and retry count made the build resilient to transient network issues without changing anything else.

**`--host 0.0.0.0`:** without this, Uvicorn only accepts connections from inside the container itself — external traffic (even from another container) would be refused.

## Frontend Dockerfile — Multi-Stage Build

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Why the final image has no Node.js at all:** React is compiled to static HTML/CSS/JS at build time. The runtime stage only needs something to serve those static files — Nginx is lightweight and purpose-built for exactly that.

**`npm ci` vs `npm install`:** `ci` installs exactly what's locked in `package-lock.json` without modifying it, guaranteeing reproducible builds — important in any environment where "works on my machine" isn't good enough.

## Nginx as Reverse Proxy

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location ~ "^/[a-zA-Z0-9]{6}$" {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|ico|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Nginx serves the built React app directly, proxies `/api/*` requests to the backend container, and separately proxies bare 6-character short codes (the redirect endpoint) to the backend as well. The `try_files` fallback to `index.html` is required for React Router-style client-side routing to survive a page refresh.

**A real bug hit here:** the original regex `location ~ ^/[a-zA-Z0-9]{6}$ {` failed with `unknown directive "6}$"`. Nginx's config syntax treats `{` and `}` as block delimiters; an unquoted regex containing literal braces (meant as a quantifier) gets misparsed. The fix was wrapping the regex in quotes: `location ~ "^/[a-zA-Z0-9]{6}$" {` — quoting tells Nginx to treat the whole expression as a single string rather than attempting to parse the braces as a new block.

## Docker Compose — Local Development

```yaml
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - devlinks-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      BASE_URL: ${BASE_URL}
    depends_on:
      db:
        condition: service_healthy
    networks:
      - devlinks-network
    expose:
      - "8000"

  frontend:
    build:
      context: ./frontend
    depends_on:
      - backend
    networks:
      - devlinks-network
    ports:
      - "80:80"

volumes:
  postgres_data:

networks:
  devlinks-network:
    driver: bridge
```

### Why only `backend` and `frontend` are pushed to a registry, not `db`

`db` uses `image: postgres:15` — an unmodified, official public image pulled directly from Docker Hub. There's no `build:` step for it because there's nothing custom to build; it's the same image anyone, anywhere, pulls from the same public source. Only images built from this project's own source code (`backend`, `frontend`) get pushed to the private Azure Container Registry — pushing an unmodified public image to a private registry would just be redundant duplication with no benefit.

### Networking model

Containers on the same Compose network resolve each other by **service name**, not `localhost`. This is why the backend's `DATABASE_URL` uses `@db:5432` — Docker's internal DNS resolves `db` to the database container automatically. Only the frontend's port 80 is published to the host (`ports:`); the backend and database use `expose`/no port mapping at all, meaning they are reachable only from other containers on the same network, never directly from outside.

## Secrets Management — What Changed and Why

The first version of `docker-compose.yml` had `POSTGRES_USER`/`POSTGRES_PASSWORD`/`DATABASE_URL` hardcoded directly in the file, which was then committed to GitHub.

**The reasoning applied to fix this, in full:**

A credential is only a meaningful secret if it grants access to something real and reachable. On a laptop, `db` is a hostname that only resolves inside a Docker network that exists nowhere outside that machine — the credential `devlinks:devlinks` was not capable of accessing anything from the outside, dummy or not. Even so, leaving real-looking credentials hardcoded in a committed file was corrected, for two reasons that matter regardless of whether the specific value is dangerous right now:

1. **Habit formation** — normalizing hardcoded credentials, even harmless ones, builds the wrong reflex for the moment a credential *does* become real (e.g., the instant this app moved to a publicly reachable cloud VM).
2. **Signal to reviewers** — a hardcoded credential in a committed file signals "this person doesn't have the secrets-handling reflex," regardless of context.

**The fix:** all credential values were moved into a root-level `.env` file (gitignored), referenced in `docker-compose.yml` via `${VARIABLE}` substitution:

```
# .env (gitignored, never committed)
POSTGRES_USER=devlinks
POSTGRES_PASSWORD=devlinks
POSTGRES_DB=devlinks
BASE_URL=http://localhost
```

```
# .env.example (committed — placeholders only)
POSTGRES_USER=changeme
POSTGRES_PASSWORD=changeme
POSTGRES_DB=devlinks
BASE_URL=http://localhost
```

**What stayed inline in `docker-compose.yml` rather than moving to `.env`:** the database hostname (`db`) and port (`5432`) — these are structural facts about the Compose setup itself, not secrets, and keeping them next to the service definitions that define them avoids the two drifting out of sync.

**The `BASE_URL` pattern specifically** is what makes the same `docker-compose.yml` work across every environment in this project without any code changes:

| Environment | `BASE_URL` value |
|---|---|
| Local development | `http://localhost` |
| Azure Linux VM | `http://<VM public IP>` |
| (Future) custom domain | `https://devlinks.example.com` |

Same file, same image, different `.env` per environment — this is the same underlying pattern later used by Kubernetes ConfigMaps/Secrets and Azure Key Vault, just at its simplest possible expression here.

## Production Compose File

A second file, `docker-compose.prod.yml`, was created specifically for cloud deployment. It differs from the local file in exactly one structural way: `backend` and `frontend` use `image:` (pull a pre-built image from ACR) instead of `build:` (build from local source). The deployment target never sees this project's source code or Dockerfiles — only the final, already-built images.

## Verification

```bash
docker compose up -d
docker compose ps        # all three services Up/healthy
curl http://localhost/health
```

Confirmed: request flows from `curl` → Nginx (port 80) → proxied to FastAPI (port 8000, internal) → PostgreSQL (port 5432, internal) → response returned through the same path.
