# CI/CD — GitHub Actions

This document covers the automated build-and-deploy pipeline that replaces the manual `docker build` / `docker push` / SSH-and-redeploy sequence used earlier in the project.

## What This Automates

Every previous deployment to the Linux VM was done by hand: build images locally, push to ACR, SSH into the VM, pull, restart. This pipeline performs the identical sequence automatically on every push to `main`.

```
git push origin main
        │
        ▼
GitHub Actions triggers
        │
        ├─► Build backend image
        ├─► Build frontend image
        ├─► Push both to Azure Container Registry
        │
        ▼
SSH into the Linux VM
        │
        └─► docker compose pull && docker compose up -d
```

## Azure Service Principal

GitHub Actions needs permission to act against Azure without ever holding actual user login credentials. A Service Principal is Azure's app-specific, non-human identity for exactly this purpose.

```bash
MSYS_NO_PATHCONV=1 az ad sp create-for-rbac \
  --name devlinks-github-actions \
  --role contributor \
  --scopes /subscriptions/<subscription-id>/resourceGroups/devlinks-rg \
  --sdk-auth
```

**Scoping note:** `--scopes` is limited to the `devlinks-rg` resource group specifically, not the whole subscription. This is the principle of least privilege in practice — if this credential were ever compromised, the damage is contained to this one project's resources, nothing else in the Azure account.

**`MSYS_NO_PATHCONV=1` note:** running this command from Git Bash on Windows (MINGW64) without this prefix causes Git Bash to misinterpret the `/subscriptions/...` argument as a Windows filesystem path and silently mangle it, producing a `MissingSubscription` error from Azure that has nothing to do with Azure itself. This environment variable disables that path auto-conversion for the one command it's needed on.

The command's JSON output (`clientId`, `clientSecret`, `subscriptionId`, `tenantId`) was stored as a single GitHub Secret.

## GitHub Secrets Used

| Secret | Purpose |
|---|---|
| `AZURE_CREDENTIALS` | Full Service Principal JSON, used to authenticate the workflow to Azure |
| `ACR_LOGIN_SERVER` | The registry's hostname (`devlinksacr.azurecr.io`) |
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `VM_HOST` | The Linux VM's public IP |
| `VM_SSH_PRIVATE_KEY` | The private half of the SSH key pair used to access the VM |

**Why GitHub Secrets specifically:** encrypted at rest, automatically redacted from workflow logs even if accidentally printed, and scoped only to workflows running in this repository. `VM_SSH_PRIVATE_KEY` is the single most sensitive value in this entire project — it grants direct shell access to the VM — and a GitHub Secret is the only place it's ever stored outside the local machine's own `~/.ssh` directory.

## The Workflow File

`.github/workflows/deploy.yml`:

```yaml
name: Build and Deploy DevLinks

on:
  push:
    branches:
      - main

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Log in to ACR
        uses: docker/login-action@v3
        with:
          registry: ${{ secrets.ACR_LOGIN_SERVER }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and push backend
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: true
          tags: ${{ secrets.ACR_LOGIN_SERVER }}/devlinks-backend:latest

      - name: Build and push frontend
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          push: true
          tags: ${{ secrets.ACR_LOGIN_SERVER }}/devlinks-frontend:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Azure VM
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VM_HOST }}
          username: azureuser
          key: ${{ secrets.VM_SSH_PRIVATE_KEY }}
          script: |
            cd ~/devlinks
            docker compose pull
            docker compose up -d
            docker image prune -f
```

### Key design points

**Two separate jobs, with `needs: build-and-push`:** the `deploy` job will not run unless `build-and-push` succeeds first. A broken build or failing Dockerfile can never reach the live VM — deployment is gated on a successful build, not run unconditionally.

**`runs-on: ubuntu-latest`:** GitHub provides a temporary, disposable Linux VM to execute each job — entirely separate from the project's own Azure VM. It exists only for the few minutes the job runs, then is destroyed.

**The deploy step's script** is identical to the commands used manually throughout earlier development — `docker compose pull`, `docker compose up -d`, `docker image prune -f` (the last step prevents the VM's disk from slowly filling with superseded image versions over time).

## First Run — What Failed and Why

The first pipeline run failed at the "Log in to ACR" step with:

```
Logging into docker.io...
Error: ... unauthorized: incorrect username or password
```

The log explicitly showed the action attempting to authenticate against `docker.io` (Docker Hub) rather than the intended ACR registry — meaning the `registry` parameter wasn't resolving to the expected value, most likely due to a typo or whitespace mismatch in how the corresponding GitHub Secret was entered. Re-verifying and re-entering all three ACR-related secrets exactly as returned by `az acr credential show` resolved it; the pipeline succeeded fully on the next run.

This is documented because secret/credential mismatches are one of the most common CI/CD failure modes in practice, and the diagnostic approach (read what registry the tool actually tried to use, not just "it failed") is the transferable skill.

## Verification After a Successful Run

```bash
az acr repository show-tags --name devlinksacr --repository devlinks-backend --output table
az acr repository show-tags --name devlinksacr --repository devlinks-frontend --output table
```

```bash
ssh azureuser@<vm-ip>
cd ~/devlinks
docker compose ps
```

Confirmed: both containers showed an "Up" duration matching the pipeline's run time, while the `db` container's uptime remained unchanged — confirming the deploy step correctly restarted only the services that actually had new images, leaving the database untouched.

## Outcome

From this point forward, deploying a code change requires only:

```bash
git push origin main
```

No manual build, push, or SSH steps — the full chain from source code to live cloud deployment is automated.
