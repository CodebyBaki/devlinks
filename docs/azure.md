# Azure — Cloud Infrastructure

This document covers every Azure resource provisioned for this project, the reasoning behind each, and the exact commands used.

## Resource Group

```bash
az group create --name devlinks-rg --location centralus
```

A Resource Group is Azure's organizational container — every resource created for this project belongs to it. Critically, deleting the resource group deletes everything inside it in one operation, which is how this project will be cleaned up when no longer needed.

**Note on region:** this project was originally started in `eastus`, then moved to `centralus` after hitting capacity/quota issues — see [`troubleshooting.md`](./troubleshooting.md) for the full story. All resources below are consistently in whichever region the resource group itself was created in.

## Networking

### Virtual Network and Subnet

```bash
az network vnet create \
  --resource-group devlinks-rg \
  --name devlinks-vnet \
  --address-prefix 10.0.0.0/16 \
  --subnet-name devlinks-subnet \
  --subnet-prefix 10.0.1.0/24
```

A VNet is a private, isolated network inside Azure. The `/16` address space (up to 65,536 addresses) is subdivided into a `/24` subnet (up to 256 addresses) where VMs actually attach. This separation matters more as infrastructure grows — splitting subnets by purpose (VMs vs. databases vs. future AKS nodes) is a standard pattern, even though this project currently uses just one.

### Network Security Group (NSG) — Firewall

```bash
az network nsg create --resource-group devlinks-rg --name devlinks-nsg
```

NSGs operate on a **default-deny** basis: all traffic is blocked unless an explicit rule allows it. Three rules were added:

```bash
# SSH — remote management of the Linux VM
az network nsg rule create \
  --resource-group devlinks-rg --nsg-name devlinks-nsg \
  --name AllowSSH --priority 100 \
  --destination-port-ranges 22 --access Allow --protocol Tcp

# HTTP — the actual application traffic
az network nsg rule create \
  --resource-group devlinks-rg --nsg-name devlinks-nsg \
  --name AllowHTTP --priority 110 \
  --destination-port-ranges 80 --access Allow --protocol Tcp

# RDP — remote management of the Windows VM
az network nsg rule create \
  --resource-group devlinks-rg --nsg-name devlinks-nsg \
  --name AllowRDP --priority 120 \
  --destination-port-ranges 3389 --access Allow --protocol Tcp
```

**What is deliberately never opened:** port 8000 (backend) and port 5432 (PostgreSQL) are never exposed via the NSG. Both remain reachable only from other containers on the same internal Docker network — mirroring exactly the local development setup, where only Nginx (port 80) is the public entry point.

**Priority numbers** are spaced (100, 110, 120) rather than sequential, leaving room to insert future rules between existing ones without renumbering.

## SSH Key Pair

```bash
ssh-keygen -t rsa -b 4096 -C "devlinks-azure-vm"
```

Generates a private/public key pair. The public key is installed on the Linux VM at creation time; the private key never leaves the local machine (and later, is stored as an encrypted GitHub Secret for CI/CD use — see [`cicd.md`](./cicd.md)). SSH key authentication avoids transmitting any password over the network.

## Linux VM

```bash
az vm create \
  --resource-group devlinks-rg \
  --name devlinks-vm-linux \
  --image Ubuntu2204 \
  --size Standard_D2s_v3 \
  --admin-username azureuser \
  --ssh-key-values ~/.ssh/id_rsa.pub \
  --vnet-name devlinks-vnet \
  --subnet devlinks-subnet \
  --nsg devlinks-nsg \
  --public-ip-sku Standard
```

**VM size note:** `Standard_B1s` (the originally intended, free-tier-eligible size) was unavailable due to a combination of subscription quota limits and regional capacity restrictions across three different regions. `Standard_D2s_v3` was used instead — broadly available, not free-tier, but inexpensive for short-lived/stoppable usage. Full detail in [`troubleshooting.md`](./troubleshooting.md).

### Docker installation (Ubuntu 22.04)

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
```

Installed via Docker's official repository (not Ubuntu's default packages, which lag behind). The GPG key verification step ensures packages haven't been tampered with. Adding the user to the `docker` group (followed by a fresh login) allows running Docker commands without `sudo`.

Verified with:

```bash
docker run hello-world
```

## Azure Container Registry (ACR)

```bash
az acr create --resource-group devlinks-rg --name devlinksacr --sku Basic
```

ACR bridges local builds and cloud deployment — both the local machine and any cloud VM need a shared place to exchange container images, since they can't access each other's local Docker storage directly.

```bash
az acr login --name devlinksacr
docker tag devlinks-backend:latest devlinksacr.azurecr.io/devlinks-backend:latest
docker tag devlinks-frontend:latest devlinksacr.azurecr.io/devlinks-frontend:latest
docker push devlinksacr.azurecr.io/devlinks-backend:latest
docker push devlinksacr.azurecr.io/devlinks-frontend:latest
```

Only `devlinks-backend` and `devlinks-frontend` are pushed — `postgres:15` is an unmodified public image with nothing custom to push (see [`docker.md`](./docker.md) for the full reasoning).

### Authenticating the VM to ACR

The VM doesn't share the local machine's Azure CLI session, and installing the full Azure CLI just for registry login was avoided in favor of ACR's built-in admin credentials:

```bash
az acr update --name devlinksacr --admin-enabled true
az acr credential show --name devlinksacr --output table
```

On the VM:

```bash
docker login devlinksacr.azurecr.io
```

**Production note:** admin credentials are a single shared username/password, convenient for a learning project but less secure than per-identity access control. A more production-appropriate approach (Azure Managed Identity) is the intended path when this project's infrastructure moves to AKS in a later phase.

## Deploying on the Linux VM

A separate compose file, `docker-compose.prod.yml`, was placed on the VM (not the full source repo):

```bash
mkdir -p ~/devlinks
cd ~/devlinks
# docker-compose.yml (uses image: not build:) and .env created here
docker compose up -d
```

`.env` on the VM sets `BASE_URL` to the VM's actual public IP — the same variable-substitution pattern used locally, now pointing at a real, internet-reachable address instead of `localhost`.

Verified both internally (`curl http://localhost/health` on the VM) and externally (visiting the public IP from a regular browser).

## Windows VM

```bash
az vm create \
  --resource-group devlinks-rg \
  --name devlinks-win-vm \
  --computer-name devlinkswin \
  --image Win2022Datacenter \
  --size Standard_D2s_v3 \
  --admin-username azureadmin \
  --admin-password "<strong password>" \
  --vnet-name devlinks-vnet \
  --subnet devlinks-subnet \
  --nsg devlinks-nsg \
  --public-ip-sku Standard
```

**`--computer-name` note:** Windows enforces a 15-character limit on computer names — a constraint that doesn't exist on Linux. The Azure resource name (`devlinks-win-vm`) and the actual Windows OS computer name (`devlinkswin`) were set separately to avoid the resource name itself needing to be awkwardly short.

**Authentication note:** Windows VMs use password-based authentication by default (`--admin-password`) rather than SSH keys — a platform difference, not a security downgrade in this context, since RDP access is still gated by a single, strong credential.

### What was attempted on the Windows VM, and why each path was chosen or abandoned

This project deliberately explored multiple deployment strategies on Windows Server, since this is exactly the kind of judgment call a real DevOps role requires. Full narrative and reasoning in [`troubleshooting.md`](./troubleshooting.md); summary here:

1. **Running the existing Linux-based Docker images directly on Windows** — not possible without modification. Windows containers and Linux containers require matching host kernels; Docker on Windows Server defaults to Windows container mode. Running Linux containers requires Hyper-V-based isolation, which itself depends on nested virtualization support from the underlying Azure VM size — uncertain and not pursued further once the cost/benefit didn't justify continued investigation.
2. **IIS configured as a reverse proxy (via Application Request Routing)** — the Windows-native equivalent of Nginx's reverse proxy role. IIS and the URL Rewrite module were installed successfully; the ARR module installation had a GUI-visibility issue that wasn't resolved in the time available. Documented honestly as a partially completed path rather than presented as fully working.
3. **Running the FastAPI backend as a native Windows Service** (no containers at all) — Python installed directly on the Windows VM, with the intent to wrap `uvicorn` using NSSM (Non-Sucking Service Manager) so it would appear in `services.msc` exactly like a traditional enterprise application. This mirrors real Windows Server deployment patterns that predate (and still coexist with) containerization. PostgreSQL was installed natively (also as a Windows Service, by its own installer) as part of this path. This path was stopped before full completion in favor of prioritizing CI/CD and documentation — see [`troubleshooting.md`](./troubleshooting.md) for exactly where it was left off.

**The value of documenting an incomplete path:** knowing *which* approach fits a given constraint (existing Linux images vs. Windows-native rebuild vs. no containers at all) is itself the skill being demonstrated — not just the ability to execute one path successfully.
