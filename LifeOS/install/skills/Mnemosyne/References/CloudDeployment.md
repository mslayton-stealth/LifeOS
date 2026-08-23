# Cloud Deployment (Optional, Documentation Only)

This pack ships **no cloud code**. Local-first is the default. Cloud deployment is a topology you build yourself — this document describes the recommended shape so you don't have to design it from scratch.

The pack's MCP server speaks Cayley's HTTP API over `$CAYLEY_BASE_URL`. Whether Cayley runs on `127.0.0.1:64210` or on a remote VM behind a tunnel doesn't matter to the server — only the URL changes.

## When to deploy to the cloud

- **You want graph access from multiple devices.** Local-only means the graph lives where you ran the installer.
- **You want the graph to persist when your laptop sleeps.** A small always-on VM is cheap.
- **You want backups handled by a cloud provider's snapshot system.** Easier than scheduling local backups.

You probably **don't** need cloud deployment if:

- You only use PAI on one device.
- You don't need write availability when offline.
- You're fine with manual `cp mnemosyne.bolt mnemosyne.bolt.bak`.

## Recommended topology — GCP

This pack's upstream lineage runs on GCP, so the documented topology is GCP-native. AWS / Azure / Hetzner / Fly.io equivalents are intentionally not provided here — pick one cloud, adapt the patterns.

### Two projects (minimal)

| Project | Purpose |
|---|---|
| `<your-prefix>-graph` | Cayley VM, VPC, KMS, Secret Manager, Terraform state |
| `<your-prefix>-data` | (Optional) external data sources, ingestion pipelines |

You can run with one project if quota allows. Two-project split makes IAM blast-radius smaller.

### Cayley VM

| Resource | Recommended |
|---|---|
| Machine type | `e2-small` (2 vCPU, 2GB RAM) for personal use. Scale to `n2-standard-2` if hot reads are heavy. |
| OS | Debian 12 minimal |
| Disk | 50GB SSD, `prevent_destroy=true` in your terraform |
| Region | Pick one near you. `us-west1` or `us-east4` for North America. |
| Zone | Single zone — no HA needed for personal use. |
| Service account | Dedicated SA with `roles/secretmanager.secretAccessor` on whatever secrets you store. |

### Networking

- **VPC** — single subnet in your region.
- **No external IP** on the VM. Use IAP for SSH (`gcloud compute ssh --tunnel-through-iap`).
- **Cloud NAT** for outbound (Cayley pulls binaries, possibly logs to Cloud Logging).
- **Firewall:** allow IAP source ranges (`35.235.240.0/20`) on port 22; deny everything else inbound.

### Storage

- **Cayley BoltDB** on the VM's persistent disk at `/var/lib/cayley/mnemosyne.bolt`.
- **Snapshots** scheduled daily via `gcloud compute resource-policies`.
- **Optional** — periodic `gsutil cp` of the bolt file to a GCS bucket with versioning, for off-VM backup.

### Tunneling from your laptop

```bash
# Start a persistent SSH tunnel via IAP. Forwards local 64210 → VM 64210.
gcloud compute start-iap-tunnel cayley-vm 64210 \
  --local-host-port=localhost:64210 \
  --zone=us-west1-a \
  --project=<your-prefix>-graph
```

Then your MCP server (with `CAYLEY_BASE_URL=http://localhost:64210`) speaks to remote Cayley without any code change.

### Authentication

The MCP server does NOT do auth. The tunnel + IAP provide auth (only your IAM identity can open the tunnel). Don't expose Cayley to the public internet; rely on the tunnel boundary.

If you need stronger auth (e.g. for multi-user shared graphs), put a reverse proxy (Caddy, nginx) in front of Cayley with mTLS or OIDC. That's beyond this pack's scope.

### Encryption

- **At rest:** the persistent disk uses Google's default encryption. For CMEK, attach a Cloud KMS key — `projects/<your-prefix>-graph/locations/us-west1/keyRings/.../cryptoKeys/cayley-disk`.
- **In transit:** IAP tunnel is TLS-encrypted end to end.

### Cost (rough)

| Component | Per month |
|---|---|
| `e2-small` VM (running 24/7) | ~$15 |
| 50GB SSD | ~$8 |
| Cloud NAT (low traffic) | ~$1 |
| Cloud KMS (optional) | ~$1 |
| **Total** | **~$25/mo** |

Stop the VM between sessions to drop to $8/mo (disk only).

## What this document doesn't ship

- **Terraform.** You write your own. The topology above maps cleanly to standard GCP terraform modules. Use the official `terraform-google-modules` collection.
- **Shell scripts.** No `gcloud` invocations, no IAM helpers, no startup scripts. The patterns are documented; the implementation is yours.
- **Multi-cloud abstractions.** Don't try to be portable. Pick a cloud, commit, and use its primitives.

## Why no cloud code in the pack

Three reasons:

1. **Security boundary.** Cloud deployments require credentials, project IDs, and account structures that vary per user. Shipping code with those embedded — even templated — increases the chance of personal data leaking into a public pack.
2. **Cloud drift.** GCP APIs change. Shipping cloud code means maintaining cloud code. Documentation ages better.
3. **Upstream review.** This pack targets contribution back to PAI mainline. Mainline avoids cloud-vendor code. Documentation describes the topology without forcing PAI to adopt a specific cloud.

## Local-first remains the default

If you don't deploy to the cloud, you lose nothing. Mnemosyne works exactly the same on `127.0.0.1:64210` against a single BoltDB file. The cloud path is an availability optimization, not a feature.
