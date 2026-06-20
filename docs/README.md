# DevLinks — Full-Stack DevOps Portfolio Project

DevLinks is a URL shortener built to demonstrate a complete DevOps lifecycle: local development, containerization, cloud provisioning on Azure, multi-OS deployment, and full CI/CD automation.

This isn't just "an app that works" — it's documented end-to-end, including the real troubleshooting that came up along the way, because debugging real infrastructure problems is exactly what DevOps work actually looks like.

## Architecture

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│   Frontend Service        │        │   Backend Service             │
│   React + Vite             │◄──────►│   Python FastAPI               │
│   Served by Nginx           │  HTTP  │   Handles shortening + lookup │
│   Port 80                   │        │   Port 8000 (internal only)   │
└─────────────────────────┘        └──────────────────────┬───────┘
                                                          │
                                                ┌─────────▼────────┐
                                                │   PostgreSQL DB    │
                                                │   Port 5432         │
                                                │   (internal only)   │
                                                └──────────────────┘
```

Two independently deployable microservices (frontend, backend) plus a database, wired together with Docker Compose and fronted by Nginx as a reverse proxy.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Nginx (production serve) |
| Backend | Python, FastAPI, SQLAlchemy, Uvicorn |
| Database | PostgreSQL 15 |
| Containerization | Docker, Docker Compose, multi-stage builds |
| Cloud | Microsoft Azure (Resource Groups, VNet, NSG, VMs, ACR) |
| CI/CD | GitHub Actions |
| Operating Systems | Ubuntu 22.04 LTS (Linux VM), Windows Server 2022 (Windows VM) |

## What This Project Demonstrates

- **Containerization** — multi-stage Docker builds for both a Python backend and a React frontend, optimized for small image size and security
- **Service orchestration** — Docker Compose managing three services with proper internal networking, health checks, and dependency ordering
- **Secrets management** — environment variables externalized from code, never committed; the actual reasoning behind what counts as a "real" secret vs. safe-to-commit config
- **Cloud networking** — Azure Virtual Networks, subnets, and Network Security Groups configured from first principles (default-deny firewall posture, explicit allow rules only for required ports)
- **Compute provisioning** — Azure VM creation via CLI, including real-world capacity/quota troubleshooting across multiple regions
- **Container registries** — Azure Container Registry used to bridge local builds and cloud deployment
- **Cross-platform deployment** — the same application deployed on both Linux (via Docker) and Windows Server (via IIS reverse proxy, with native Windows Service deployment explored as an alternative)
- **CI/CD automation** — a complete GitHub Actions pipeline that builds, pushes, and deploys on every push to `main`, with scoped, least-privilege Azure credentials

## Documentation Index

| File | Covers |
|---|---|
| [`setup.md`](./setup.md) | Local app build — backend, frontend, initial run and verification |
| [`docker.md`](./docker.md) | Dockerfiles, multi-stage builds, Docker Compose, Nginx reverse proxy config |
| [`azure.md`](./azure.md) | Resource groups, networking, NSGs, VM provisioning (Linux + Windows), ACR |
| [`cicd.md`](./cicd.md) | GitHub Actions workflow, Azure Service Principal, secrets management |
| [`troubleshooting.md`](./troubleshooting.md) | Every real issue hit during this project, root cause, and fix — written honestly |

## Live Components (at time of writing)

| Component | Detail |
|---|---|
| Linux VM | Ubuntu 22.04, Azure Central US, running full stack via Docker Compose |
| Windows VM | Windows Server 2022, Azure Central US, IIS configured as reverse proxy |
| Container Registry | Azure Container Registry, private, Basic SKU |
| CI/CD | GitHub Actions, triggers on push to `main` |

> **Note on cost management:** VMs in this project are stopped (`az vm stop`) when not actively in use, to avoid unnecessary Azure billing. This is a deliberate operational habit, not an oversight if you find them stopped when reviewing.

## Repository Structure

```
devlinks/
├── backend/                 # FastAPI service
│   ├── Dockerfile
│   ├── main.py
│   ├── models.py
│   ├── database.py
│   └── requirements.txt
├── frontend/                 # React service
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
├── .github/workflows/
│   └── deploy.yml            # CI/CD pipeline
├── docker-compose.yml        # Local development (builds from source)
├── docker-compose.prod.yml   # Cloud deployment (pulls pre-built images from ACR)
├── docs/                      # This documentation
└── .env.example               # Template for required environment variables
```
