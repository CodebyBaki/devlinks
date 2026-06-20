# Troubleshooting Journal

This document is a deliberately honest record of every real problem encountered while building this project, the root cause of each, and how it was resolved. Nothing here was scripted in advance — these are the actual blockers hit during development, kept in because diagnosing real infrastructure problems is the actual substance of DevOps work, not an embarrassing footnote to hide.

---

## 1. PostgreSQL Authentication Failure (Local Development)

**Symptom:**
```
psycopg2.OperationalError: connection to server at "localhost" (::1), port 5432 failed:
FATAL: password authentication failed for user "devlinks"
```

**Root cause:** the application expected a PostgreSQL user/database named `devlinks` to already exist, but no such user had been created — there was no PostgreSQL instance running with that configuration yet.

**Fix:** ran a disposable PostgreSQL container with the expected credentials baked in via environment variables at container creation time, rather than configuring an existing local PostgreSQL installation manually.

---

## 2. Port Conflict on 5432

**Symptom:** a second PostgreSQL instance (from an unrelated existing project) was already bound to port 5432 on both localhost and an existing Docker container.

**Root cause:** the new PostgreSQL container's default port mapping (`5432:5432`) collided with an already-occupied host port.

**Fix:** remapped the host-side port only (`-p 5433:5432`), leaving the container's internal port untouched. Updated `DATABASE_URL` to reference `localhost:5433`. Key concept: the container always listens on its own internal port; only the host-side mapping needs to be unique per project.

---

## 3. Docker Build Timeout — `pip install`

**Symptom:**
```
pip._vendor.urllib3.exceptions.ReadTimeoutError: HTTPSConnectionPool(host='files.pythonhosted.org', port=443): Read timed out.
```

**Root cause:** a network-level timeout while pip downloaded dependencies during the Docker build — base image pulls were also unusually slow in the same run, pointing to a transient network/Docker Desktop networking issue rather than a code problem.

**Fix:** added `--default-timeout=120 --retries 5` to the `pip install` command in the backend Dockerfile, and restarted Docker Desktop to clear any stale internal networking state. Rebuild succeeded.

---

## 4. Nginx Config Syntax Error — Regex Braces

**Symptom:**
```
nginx: [emerg] unknown directive "6}$" in /etc/nginx/conf.d/default.conf:18
```

**Root cause:** an unquoted regex location block — `location ~ ^/[a-zA-Z0-9]{6}$ {` — used curly braces as a regex quantifier, but Nginx's config parser also uses curly braces to delimit blocks. The parser interpreted `{6}` as the start of a new block rather than part of the regex.

**Fix:** wrapped the regex in quotes: `location ~ "^/[a-zA-Z0-9]{6}$" {`. Quoting tells Nginx to treat the entire expression as one string literal.

---

## 5. Frontend Container Exiting Immediately

**Symptom:** `docker compose ps` showed `devlinks-frontend` with status `Exited (1)`, while backend and db remained healthy.

**Root cause:** direct consequence of issue #4 above — Nginx failed to start at all due to the config syntax error, so the container exited immediately after launch.

**Fix:** resolved by the same fix as #4; once the config was valid, the container started and stayed running.

---

## 6. Incorrect Redirect URL Structure

**Symptom:** a generated short link (`http://localhost/api/LJD3Kr`) returned `{"detail":"Not Found"}` instead of redirecting.

**Root cause:** the backend's `BASE_URL` environment variable was set to `http://localhost/api`, but the redirect route (`/{short_code}`) lives at the application root, not under `/api/`. The `/api/` prefix is only correct for the management endpoints (`/api/shorten`, `/api/links`); concatenating it onto the redirect URL produced a path Nginx's routing rules didn't match to the right backend route.

**Fix:** changed `BASE_URL` to `http://localhost` (no `/api` suffix). Verified the corrected short URL redirected correctly.

---

## 7. Hardcoded Database Credentials Committed to Git

**Issue (not a technical failure, a practice correction):** `docker-compose.yml` initially contained `POSTGRES_USER`/`POSTGRES_PASSWORD`/`DATABASE_URL` hardcoded directly, and was committed to a public GitHub repository in that state.

**Reasoning applied:** while the specific credential (`devlinks:devlinks`) posed no real risk at that point — it only resolved inside a Docker network that didn't exist outside the local machine — hardcoding real-looking credentials in a committed file was still corrected as a matter of practice, since the habit (not just the specific value) is what matters once a credential becomes genuinely reachable, as happened later when the app moved to a public cloud VM.

**Fix:** moved all credential values into a root-level `.env` file (added to `.gitignore`), referenced in `docker-compose.yml` via `${VARIABLE}` substitution. A `.env.example` with placeholder values was committed instead, documenting what variables are required without exposing real values. See [`docker.md`](./docker.md) for the full secrets-handling reasoning.

**Note on Git history:** a new commit removing hardcoded values does not erase them from prior commits in Git history. For this specific low-risk, dummy credential, rotating it was judged unnecessary — but the general rule (any *real* secret accidentally committed must be rotated immediately, not just removed in a follow-up commit) was explicitly noted for future projects.

---

## 8. Azure VM Creation Failure — Public IP Quota Exceeded

**Symptom:**
```
ResourceCountExceedsLimitDueToTemplate: Subscription has a quota of 3 for PublicIpAddress... currently has 3 resources
QuotaExceeded: ... Total Regional Cores quota. Current Limit: 4, Current Usage: 4
```

**Root cause:** an existing, separate Kubernetes project (an AKS cluster from earlier work) had already consumed the subscription's entire public IP and vCPU core quota in the `eastus` region. AKS clusters provision underlying VMs and IPs that don't appear in a simple `az vm list`, but still count against the same regional quotas.

**Diagnosis approach:** `az vm list` returned empty, but `az network public-ip list` revealed three IPs all belonging to an `MC_*`-prefixed resource group — the auto-generated resource group Azure creates for AKS "managed clusters" — confirming the AKS cluster, not any standalone VM, was the actual consumer of the quota.

**Decision point:** rather than delete the existing AKS cluster (still in active use for a separate project), the chosen fix was to provision this project's resources in a different Azure region with independent quota tracking.

**Fix:** confirmed via `az vm list-usage --location <region> --output table` that `westus2` and `centralus` both had a full, untouched quota (`0/4` cores used), unlike `eastus` (`4/4`). Recreated the resource group and networking resources in `centralus`.

---

## 9. VM Size Unavailable — Capacity Restrictions Across Multiple Regions

**Symptom:**
```
SkuNotAvailable: Standard_B1s is currently not available in location 'westus2'
SkuNotAvailable: Standard_B1ms is currently not available in location 'westus2'
```

**Root cause:** distinct from the quota issue above — this was a **capacity** restriction, meaning Azure's physical hardware pool for that specific VM size was temporarily full in that region, independent of the subscription's own allowed quota. `B1`-family burstable VMs are popular (free-tier eligible) and experience this more often than other sizes.

**Diagnosis approach:** checked SKU availability directly via `az vm list-skus`, and separately confirmed that `southafricanorth` doesn't offer the `B1` family at all in that region (only much larger `B16` variants) — a regional hardware-availability gap, not a quota or capacity issue.

**Decision point:** rather than continue hunting for B-series availability region by region, switched to `Standard_D2s_v3` — a broadly available general-purpose size used across nearly all Azure regions, accepting the small cost tradeoff (not free-tier eligible) in exchange for unblocking progress. VMs are stopped (`az vm stop`) when not actively in use to minimize that cost.

**Fix:** VM creation succeeded immediately with `Standard_D2s_v3` in `centralus`.

---

## 10. Git Bash Path Mangling — Azure CLI Service Principal Creation

**Symptom:**
```
Creating 'contributor' role assignment under scope
'C:/Program Files/Git/subscriptions/<id>/resourceGroups/devlinks-rg'
(MissingSubscription) The request did not have a subscription or a valid tenant level resource provider.
```

**Root cause:** Git Bash (MINGW64) on Windows automatically rewrites command-line arguments that look like absolute Unix paths (anything starting with `/`) into Windows-style paths. The `--scopes /subscriptions/.../resourceGroups/devlinks-rg` argument was silently mangled into a path rooted at the Git installation directory before Azure CLI ever saw it.

**Fix:** prefixed the command with `MSYS_NO_PATHCONV=1`, an environment variable that disables this auto-conversion for that one invocation. This is a well-documented, standard workaround for this specific class of MINGW64 behavior.

---

## 11. GitHub Actions — ACR Login Failure on First Pipeline Run

**Symptom:**
```
Logging into docker.io...
Error: ... unauthorized: incorrect username or password
```

**Root cause:** the workflow's "Log in to ACR" step attempted to authenticate against Docker Hub's default registry rather than Azure Container Registry — indicating the `ACR_LOGIN_SERVER` GitHub Secret wasn't resolving correctly, most likely due to a naming mismatch or stray whitespace when the secret was originally entered.

**Diagnosis approach:** read the actual log output rather than assuming the cause — the log explicitly named which registry the action tried to reach, which immediately ruled out "wrong password" in favor of "wrong registry target."

**Fix:** re-verified and re-entered `ACR_LOGIN_SERVER`, `ACR_USERNAME`, and `ACR_PASSWORD` exactly as returned by `az acr credential show`, then re-triggered the pipeline with an empty commit (`git commit --allow-empty`). The pipeline completed successfully on the next run.

---

## 12. Windows Server — Linux Containers Not Supported Out of the Box

**Symptom:** Docker installed and verified working on the Windows Server VM, but `docker version` showed `Server: OS/Arch: windows/amd64` — meaning only Windows-based container images could run, not the project's existing Linux-based images (`python:3.11-slim`, `node:20-alpine`, `nginx:alpine`).

**Root cause:** containers share their host's kernel rather than virtualizing a full OS. A Windows host running in "Windows container mode" can only run Windows-based images. Running genuine Linux containers on a Windows host requires Hyper-V-based isolation — itself dependent on nested virtualization support, which is not guaranteed on every Azure VM size.

**Decision point:** rather than spend further time confirming whether the current VM size supported nested virtualization (an open question after checking `Get-ComputerInfo -Property "HyperV*"` returned ambiguous, partially blank results), the decision was made to pivot the Windows VM's purpose entirely — toward demonstrating Windows-native deployment patterns (IIS reverse proxy, native Windows Service) instead of forcing Linux containers onto Windows.

**Outcome:** documented as a deliberately abandoned path, not a silently skipped one — see [`azure.md`](./azure.md) for the three alternative paths considered and which were pursued.

---

## 13. Windows Server — Application Request Routing (ARR) Not Appearing in IIS Manager

**Symptom:** after installing the ARR module via its `.msi` installer, "Application Request Routing Cache" did not appear in IIS Manager's server-level feature list, where it was expected to show alongside Authentication, Compression, etc.

**Root cause:** not fully diagnosed. Most likely causes considered: the ARR module failing to register fully with IIS without a full server restart (rather than just `iisreset`), or an incomplete/failed install that didn't surface a clear error during the installer run itself.

**Decision point:** rather than continue troubleshooting an IIS GUI-specific issue with uncertain root cause, time was redirected toward the native Windows Service deployment path and, subsequently, CI/CD — judged to be higher-value uses of remaining time than further debugging a partially-explored Windows configuration path.

**Status:** left as a known, documented incomplete step rather than presented as resolved.

---

## 14. Native Windows Service Deployment — Stopped Before Completion

**Context:** as an alternative to containerized Windows deployment, Python and PostgreSQL were both installed natively on the Windows Server VM, with the intent of wrapping the FastAPI backend with NSSM to register it as a true Windows Service (the same model encountered in prior professional experience, managed via `services.msc`).

**Status at time of stopping:** Python installed and verified; PostgreSQL installed natively and a `devlinks` user/database created and verified reachable; the FastAPI backend manually verified working via `uvicorn` run directly in a terminal session. The NSSM-wrapping step itself (the part that would make it appear in `services.msc` and survive reboots) was not completed.

**Reasoning for stopping here:** with the core concept already demonstrated (native Python + native PostgreSQL + manual verification that the service runs correctly outside a container), the remaining NSSM-specific step was judged lower priority than completing CI/CD automation and full project documentation in the time available.

---

## General Lessons Captured

- **Quota errors and capacity errors look similar but have different causes and different fixes** — one is about the subscription's allowed limits, the other about a region's actual available hardware at a point in time. Diagnosing which one you're facing (and reading the exact wording Azure returns) determines whether the fix is "request more quota," "try a different region," or "try a different VM size."
- **Read the actual error/log content before assuming a cause.** Several issues in this project (the ACR login failure, the Nginx syntax error, the quota messages) were resolved quickly specifically because the literal error text was read carefully rather than guessed at.
- **Not every started path needs to be finished to be valuable.** The Windows container and IIS/ARR explorations were stopped deliberately once their cost-to-learning ratio inverted — and documenting *why* a path was stopped is itself a demonstration of engineering judgment, not a gap to hide.
