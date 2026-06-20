# Setup — Building DevLinks Locally

This document covers building DevLinks from scratch: the backend API, the frontend UI, and getting both running locally before any containerization or cloud work begins.

## Why Build Locally First

Every stage of this project follows one rule: **prove it works in the simplest possible environment before adding the next layer of complexity.** Local-first means that if something breaks later (in Docker, or on a cloud VM), we already know the application code itself is sound — narrowing down the cause faster.

## Prerequisites

- Node.js (LTS) and npm
- Python 3.11+
- Docker Desktop (used here only to run a disposable PostgreSQL container, not yet for the app itself)
- Git

## Backend — FastAPI

### Why FastAPI

FastAPI was chosen over Flask or Django for three reasons: it's async-native, it auto-generates interactive API documentation at `/docs`, and it has built-in request/response validation via Pydantic — all of which matter for a service that needs to be both fast and easy to verify manually during development.

### Project structure

```
backend/
├── main.py          # FastAPI app, routes
├── models.py        # SQLAlchemy ORM model
├── database.py       # DB connection/session setup
├── requirements.txt
├── .env.example
└── Dockerfile         # covered in docker.md
```

### Dependencies

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv pydantic
pip freeze > requirements.txt
```

| Package | Purpose |
|---|---|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server that runs FastAPI |
| `sqlalchemy` | ORM — Python objects instead of raw SQL |
| `psycopg2-binary` | PostgreSQL driver |
| `python-dotenv` | Loads `.env` variables into the environment |
| `pydantic` | Request/response validation (used internally by FastAPI) |

### Database connection (`database.py`)

Creates a SQLAlchemy engine and session factory, and exposes a `get_db()` dependency that FastAPI injects into any route needing database access — opening a session, yielding it, then closing it automatically.

### Data model (`models.py`)

A single `Link` model: `id`, `original_url`, `short_code` (indexed, unique), `created_at`, `click_count`. The unique index on `short_code` keeps lookups fast even as the table grows.

### API routes (`main.py`)

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | Health check, returns service status |
| `/api/shorten` | POST | Accepts a URL, generates a random 6-character short code, stores it |
| `/{short_code}` | GET | Looks up the code, increments click count, redirects to the original URL |
| `/api/links` | GET | Returns the 50 most recent links |

### Running a local PostgreSQL instance for development

Rather than installing PostgreSQL natively, a disposable Docker container was used:

```bash
docker run -d \
  --name devlinks-postgres \
  -e POSTGRES_USER=devlinks \
  -e POSTGRES_PASSWORD=devlinks \
  -e POSTGRES_DB=devlinks \
  -p 5433:5432 \
  -v devlinks-pgdata:/var/lib/postgresql/data \
  postgres:15
```

**Port mapping note:** `5433:5432` was used instead of the default `5432:5432` because another local project already occupied port 5432 on the host machine. The container's *internal* port is always 5432 — only the host-side port needed to change. This is a general Docker networking pattern: the right side of the `-p` flag is always the container's port; the left side is yours to choose freely, and only needs to be unique on the host.

`.env` was set accordingly:

```
DATABASE_URL=postgresql://devlinks:devlinks@localhost:5433/devlinks
BASE_URL=http://localhost:8000
```

### Verifying the backend

```bash
uvicorn main:app --reload --port 8000
```

Checks performed:
- `GET /health` → `{"status":"healthy","service":"devlinks-backend"}`
- `GET /docs` → interactive FastAPI documentation UI loads
- `POST /api/shorten` with a JSON body → returns a generated short code
- Visiting the generated short URL → redirects correctly

## Frontend — React + Vite

### Why Vite over Create React App

Vite is faster, produces smaller production builds, and is the current standard — Create React App is deprecated.

### Setup

```bash
npm create vite@latest . -- --template react
npm install
npm install axios react-hot-toast lucide-react
```

| Package | Purpose |
|---|---|
| `axios` | HTTP client for calling the backend API |
| `react-hot-toast` | Toast notifications (success/error feedback) |
| `lucide-react` | Icon set |

### API service layer (`src/services/api.js`)

All backend calls are centralized in one file rather than scattered across components. This means changing the backend's address (which happens at every later deployment stage — localhost, then a VM's public IP) requires editing exactly one environment variable, not hunting through every component.

```javascript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})
```

Vite only exposes environment variables prefixed with `VITE_` to client-side code — a deliberate security boundary so server-side secrets can't accidentally leak into a frontend bundle.

### Running the frontend

```bash
npm run dev
```

Confirmed working at `http://localhost:5173`, calling the backend at `http://localhost:8000`, with full create/list/redirect functionality verified through the UI.

## Outcome of This Stage

Two independently running services — frontend on port 5173, backend on port 8000 — talking to each other across a port boundary, backed by a containerized PostgreSQL instance. This is the foundation the rest of the project builds on: the same two services later get containerized themselves, deployed to a cloud VM, and wired into a CI/CD pipeline, without any change to the underlying application code.
