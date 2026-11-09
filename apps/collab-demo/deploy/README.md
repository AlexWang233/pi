# Linux/GCP deployment preparation

**Prepared, not deployed or Linux-validated.** No VM, project, IAM change, cloud credential,
paid model call or service installation was performed by this increment. The user deferred
GCP until local readiness and deferred investigation of the Windows Bash recovery delay.
Those decisions remain in force.

For project/IAM/network setup, VM installation, private browser access and exact demonstration
commands, use the [step-by-step GCP guide](../../../TAKE_HOME_GCP_DEPLOYMENT_GUIDE.md).
This file remains the reference for the prepared service/backup policies and acceptance gates.

## Design and trade-offs

Use one Linux Compute Engine VM and one process owning each SQLite store/workspace. The
template exposes HTTP only on loopback; evaluator access uses SSH forwarding. This avoids a
public application endpoint and a distributed filesystem. It retains a VM/process/zone failure
domain and requires manual recovery. It is a trusted-team proof of concept, not tenant isolation.

- `KillMode=control-group` asks systemd to terminate remaining processes in the service cgroup;
  after `TimeoutStopSec=90`, `SendSIGKILL=yes` permits forced termination. This is the intended
  Linux containment policy, not evidence it works with this CLI. Verify descendant shutdown
  on the VM. See [systemd kill semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html).
- `Restart=no` leaves failures for inspection. This sacrifices availability to avoid automatic
  owner replacement while filesystem effects or escaped writers are uncertain. Do not add
  automatic restart merely to make a failed demo look healthy.
- `flock` prevents cooperating starts/backups from opening the store simultaneously. It is
  not distributed fencing and does not stop a detached writer after its lock-owning host dies.
  Direct `npm start` bypasses this lock; do not run it against service-owned data.
- A mount-point condition prevents silently writing runtime data to the boot filesystem when
  the intended data disk is absent. `RequiresMountsFor` orders startup after the mount.
- Code/binaries stay read-only to the service; only data, workspace, private temporary files
  and the service home are writable. All agents share the same OS account and can read that
  account's credentials. These unit settings are not a hostile-agent sandbox.
- Backup stops the service and archives **the whole data directory**, including any SQLite
  journal/WAL sidecars and workspace. It costs downtime and excludes separately stored
  credentials/configuration. No online main-file-only SQLite copy is offered.

## Prerequisites and fixed paths

Before provisioning, select the GCP project/zone, verify current prices and available credits,
and agree on a teardown date. Existing planning ceilings are $30 infrastructure and $10 live
smoke calls, not automatic spending stops. This kit does not create cloud resources.

| Path | Required content |
| --- | --- |
| `/opt/pi` | Reviewed fork checkout; record exact revision and local changes |
| `/opt/node/bin/node` | Tested Linux Node version, at least 22.19; local Windows evidence used 22.23.4 |
| `/opt/codex/bin/codex` | Operator-installed, pinned and Linux-verified CLI when Codex is configured |
| `/etc/pi-collab/config.json` | Private host configuration based on `../config.example.json`; choose real catalog IDs |
| `/etc/pi-collab/host.env` | Private values based on `host.env.example`; mode 0600, outside Git |
| `/var/lib/pi-collab` | Mounted persistent data volume, owned by dedicated `pi-collab` user; SQLite plus `workspace/` |
| `/var/lib/pi-collab-home` | systemd-managed service home; optional CLI credentials live here, outside workspace |

Create a dedicated non-login service account and mount the data disk through the VM's normal
boot configuration before installation. Install Git/Bash, `flock`, `tar` and a compatible Node
toolchain. Prepare the root checkout with `npm ci --ignore-scripts`; hydrate pinned model data
as described in the repository environment record, then build workspace packages and the demo:

```bash
cd /opt/pi
npm run build:offline
cd apps/collab-demo
npm run check
npm run build
```

Do not run lifecycle scripts or silently replace the tested CLI with latest. Local initialization
evidence is for Codex `0.164.0-alpha.11.1` on Windows, not certification of a Linux installation.
Configure its authentication privately as the service user; a native OpenAI key alone does not
establish CLI authentication. Keep unused provider keys absent.

## Validate before starting

From the demo directory, with the service's actual environment supplied securely:

```bash
node --conditions=source --experimental-strip-types src/preflight.ts
```

Preflight checks configuration, unique user tokens, port, local model IDs, browser assets and
selected native API-key environment presence. It prints no token/key values, opens no SQLite
store, starts no socket, runs no CLI and makes no model/authentication request. A successful
result means `configuration-valid`, not live-provider or deployment readiness. This preflight
targets the documented API-key service setup; alternate native OAuth/federation authentication
is not verified by its key-presence check.

After placing the unit at `/etc/systemd/system/pi-collab.service`, inspect it before enabling:

```bash
sudo systemd-analyze verify /etc/systemd/system/pi-collab.service
sudo systemctl daemon-reload
sudo systemctl start pi-collab.service
sudo systemctl status pi-collab.service
```

Use an administrator to install the template and private files with appropriate ownership.
Do not source the environment file in shell history or print it to logs. Do not enable boot
startup until restart/reboot and process-containment checks pass. After verification, explicit
`systemctl enable pi-collab.service` enables boot startup; it does not change `Restart=no`.

## Evaluator access and acceptance checks

On the evaluator machine, replacing all uppercase placeholders:

```bash
gcloud compute ssh VM_NAME --project=PROJECT_ID --zone=ZONE -- -N -L 4310:127.0.0.1:4310
```

Open `http://127.0.0.1:4310` and exchange user tokens privately. This requires configured SSH
access; use the project's chosen SSH/IAP policy. It does not require exposing port 4310 in a
cloud firewall. See [Google's SSH forwarding guidance](https://docs.cloud.google.com/solutions/connecting-securely).

Record these as **pending** until performed on the VM:

1. Two users complete native Pi and real Codex coding turns in the same workspace; verify
   attribution, queueing, cross-lane overlap, stop, reconnect and continuation. Keep file races explicit.
2. Stop during work; inspect the service cgroup and confirm every former writer has terminated
   before starting another owner. Include CLI children and shell commands. A closed HTTP port is insufficient.
3. Inject owner failure, restart manually, and confirm original-ID retry/history plus conservative
   external interruption. Inspect uncertain file effects before a new command.
4. Reboot and confirm the persistent mount is present, stored configuration matches and receipts
   survive. Test failure with the mount absent; do not allow a fallback data directory.
5. Restore a backup into a stopped, isolated installation and verify history, receipt identity,
   uncertain execution behavior and workspace files before allowing commands.

## Backup, restore and teardown

Stop the service, verify its writers/cgroup are gone, then run as an account allowed to read data:

```bash
sudo systemctl stop pi-collab.service
bash /opt/pi/apps/collab-demo/deploy/backup.sh /var/lib/pi-collab /private-backups/pi-collab.tar.gz
tar --list --gzip --file=/private-backups/pi-collab.tar.gz
```

The backup script refuses an active service, an occupied cooperative lock, an archive inside
the data directory or an existing output file. Inspect partial output after any failure; it
is not a valid backup until checked. Archives may contain sensitive prompts/files; keep them private.

Restore into a **fresh** directory on a separate stopped validation VM, inspect archive paths,
and retain a copy of the original data. Do not merge into or overwrite an active store. Restore
the original absolute workspace location (`/var/lib/pi-collab/workspace`) and the same agent/member
configuration and build; incompatible configurations intentionally refuse reopen. Recover service
credentials separately. This runbook does not automate destructive restore or migration.

At teardown: stop/disable the service, end SSH tunnels, revoke demo tokens and provider/CLI
credentials, export required evidence, then remove the VM and review retained disks, snapshots,
static addresses and backups for ongoing charges. Check the actual cloud resource list/billing;
deleting a VM is not evidence every resource or charge disappeared.
