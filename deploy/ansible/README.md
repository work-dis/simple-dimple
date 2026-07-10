# Ansible fleet provisioning

Шаг 5 из [../../docs/PRIORITY_PLAN.md](../../docs/PRIORITY_PLAN.md). Ansible
equivalent of [`../xray/provision-node.sh`](../xray/provision-node.sh) —
written once the fleet had a second real provider (Contabo, see
[docs/DECISIONS.md, Decision 030](../../docs/DECISIONS.md)) to justify
multi-host automation instead of running the bash script by hand over SSH per
VPS. The bash script keeps working and is still the simplest path for a
one-off single node — use this when provisioning/refreshing more than one
host at a time.

## Requirements

- `ansible` on the control machine (`brew install ansible` / `pip install
  ansible`)
- `sshpass` if targets use password auth instead of SSH keys (this project's
  VPS currently do — see `../ssh.env`)
- Docker is installed automatically on the target if missing (same
  `get.docker.com` path as `../README.md` documents for manual setup)

## Usage

```bash
cp inventory.example.ini inventory.ini   # not committed, same as deploy/ssh.env
# edit inventory.ini: real hosts, ansible_password, xray_admin_session

# Provision (or refresh) every node in the inventory:
ansible-playbook -i inventory.ini provision-node.yml

# Just one node:
ansible-playbook -i inventory.ini provision-node.yml --limit contabo-fr-1

# Retire (control-plane only, container keeps running):
ansible-playbook -i inventory.ini retire-node.yml --limit contabo-fr-1 \
  -e xray_endpoint_id=<endpoint-id>

# Reactivate:
ansible-playbook -i inventory.ini reactivate-node.yml --limit contabo-fr-1 \
  -e xray_endpoint_id=<endpoint-id> -e xray_pool_code=fr-contabo-1
```

## Where this differs from `provision-node.sh`

- **Idempotent.** The bash script regenerates the X25519 keypair/UUID/shortId
  on every `register` call, even against an already-provisioned node — fine
  for a single manual run, less fine to run repeatedly against a fleet. This
  role reads crypto material back from the node's own `config.json` (plus a
  small `client-meta.json` sidecar for the public key/fingerprint, which
  REALITY doesn't need server-side) on re-runs, so keys are only generated
  once per pool.
- **Multi-host in one invocation.** One `ansible-playbook` run can
  provision/refresh an entire inventory instead of one SSH session per VPS.
- **Registration is also idempotent** — the role checks
  `GET /api/admin/endpoints` for an existing `poolCode` before `POST`-ing a
  new one, so re-running the playbook against an already-registered node
  doesn't create a duplicate endpoint.

## Verified live (2026-07-09)

Run against a throwaway third pool (`ansible-test-1`) on the existing OVH VPS
to prove the playbook end-to-end without needing new hardware: Docker
install-check, keypair generation, container start, and control-plane
registration all worked; a second run against the same pool correctly
skipped key regeneration and registration (idempotency confirmed), only
restarting the container because the templated config was byte-identical
(no-op). Retired and torn down afterwards — this pool was for testing the
tool, not a real fleet addition. See
[docs/DECISIONS.md, Decision 032](../../docs/DECISIONS.md).
