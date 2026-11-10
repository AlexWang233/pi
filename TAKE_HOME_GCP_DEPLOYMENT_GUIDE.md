# GCP deployment and demonstration guide

**Status: updated November 9, 2026; initial VM startup confirmed by user screenshots.** The Linux service is running, app and Ollama listen on loopback ports 4310 and 11434, and the app returns HTTP 200. This is user-provided startup evidence, not an assistant-run cloud check. Private browser access, real agent turns on GCP, scenario tests, and recovery/backup acceptance remain unverified.

Use this as the step-by-step companion to the [deployment kit](apps/collab-demo/deploy/README.md), [presentation](presentations/take-home/README.md), and [project wiki](llm-wiki/README.md). Replace uppercase placeholders. Follow the stages individually; the formatting and teardown steps are deliberately **not** an unattended installation script.

Jump to [cloud setup](#3-laptop-powershell-project-apis-and-access), [VM installation](#5-vm-bash-tools-and-a-mounted-data-directory), [Ollama](#7-vm-bash-run-ollama-for-the-mixed-default), [browser access](#10-laptop-powershell-open-the-gcp-app), [demonstrations](#11-demonstrations-and-exact-commands), [backup](#12-idle-restart-backup-and-acceptance-record), or [teardown](#14-teardown-from-laptop-powershell).

### How to run this guide

- **Cloud Console:** create/edit cloud resources in the browser. Sections 3 and 4 include Console alternatives; skipping their CLI commands does not remove the underlying setup requirements.
- **VM Bash:** use the VM's SSH-in-browser terminal for sections 5 through 9 and VM demonstrations. This is a different computer from your laptop.
- **Laptop PowerShell:** use your Windows terminal for the private browser tunnel in section 10. Browser SSH does not automatically forward the app to your laptop.
- Run commands individually and proceed only after success. Run `less`, `nano`, `sudoedit`, `gcloud auth login`, and private token prompts individually: they wait for user interaction. Do not paste the next command while a viewer/editor is open.
- Configuration blocks labeled **paste into editor** are file contents, not shell commands. Blocks that create a script using `<<'JS'` must be pasted in full, including the closing `JS` line.

Current VM reference (from the user's Console/SSH screenshots):

| Setting | Value |
| --- | --- |
| Project ID | `poetic-torch-514304-j4` |
| VM name | `pi-collab-demo` |
| Zone | `us-central1-c` |
| Intended source branch | `dev`; record the actual deployed commit separately |
| Laptop browser port in this guide | `14310`, forwarded to VM port `4310` |

For another deployment, replace these values with that VM's details. Find the zone in **Compute Engine → VM instances → Zone**; a zone such as `us-central1-c` is more specific than the region `us-central1`.

## 1. What you are deploying

One Linux VM runs one owner of the SQLite store and shared workspace. The browser app listens on the VM's loopback interface; an SSH tunnel makes it available at `http://127.0.0.1:14310` on your laptop. The app itself continues to use port 4310 on the VM.

```mermaid
flowchart LR
  laptop["Laptop: Alice and Bob browser sessions"] --> tunnel["Authenticated SSH tunnel through IAP"]
  tunnel --> app["VM: app on 127.0.0.1:4310"]
  app --> disk["Persistent disk: SQLite and workspace"]
  app --> openai["OpenAI API"]
  app --> ollama["VM-local Ollama on 127.0.0.1:11434"]
```

The CLI creation commands below give the VM an external IP for outbound downloads/API calls, but permit inbound SSH only from Google's Identity-Aware Proxy (IAP). They do not expose ports 4310 or 11434 publicly. A Console-created VM may have different firewall/service-account defaults; review those separately. A VM without an external IP is another option, but would need an outbound networking solution such as Cloud NAT; that is outside this small setup. [IAP access documentation](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding).

| Identity or setting | What it is for |
| --- | --- |
| Google account and GCP project | Own and administer the VM, network, disks, and billing |
| Linux user `pi-collab` | Run the app; distinct from your administrator SSH user |
| Alice/Bob tokens | Sign in to this project's browser UI; not Google credentials |
| `OPENAI_API_KEY` | Pay for/access OpenAI model calls; GCP credits do not provide this |
| Ollama | Serve the downloaded model on the VM; no paid model key required |

The current default is **OpenAI + Ollama**, not Codex. Two providers through native Pi are different from two external harnesses. See [provider/harness definitions](llm-wiki/09-technical-terms.md#provider-model-agent-harness-and-adapter).

## 2. Before creating resources

1. Choose a project you control and link an active billing account in the Cloud Console. If using promotional credits, check your actual eligibility and balance rather than assuming the assignment's advertised credit applies.
2. Set a project-scoped billing alert and a teardown date. The earlier project planning ceiling was $30 infrastructure plus $10 provider testing, not a guaranteed price or automatic spending stop. **An alerts-only budget does not cap spending.** [Google budget guidance](https://docs.cloud.google.com/billing/docs/how-to/budgets).
3. Review the chosen VM, disk, external-IP, and network costs in the [pricing calculator](https://cloud.google.com/products/calculator). Keep OpenAI billing/limits separate.
4. Have the URL and exact reviewed commit of **your fork containing this feature**. A clone does not include uncommitted local changes; do not accidentally deploy the original upstream repository without the collaboration code.
5. Have your OpenAI key available privately. Do not upload your Windows `.env`, gcloud credential cache, `node_modules`, or running SQLite files.

The example machine is `e2-standard-4` (4 vCPUs, 16 GB RAM), with a 50-GB boot disk and a separate 30-GB data disk. This is a starting configuration for building and trying CPU inference, **not a measured Ollama performance recommendation**. Verify availability, pricing, and actual model latency before relying on it. [E2 machine types](https://docs.cloud.google.com/compute/docs/general-purpose-machines#e2_machine_types).

If CPU Ollama is too slow, choose a hosted-only two-agent composition before the first start, or use recorded/local inference evidence. Do not assume the Windows GPU result applies to this VM; do not silently change agents in an existing store.

## 3. Laptop PowerShell: project, APIs, and access

**Console alternative:** select/create the project in the project picker, link billing, and enable the Compute Engine, IAP, and OS Login APIs in **APIs & Services → Library**. An administrator can grant the roles listed below through **IAM & Admin → IAM**. If using the Console for setup, continue with the Console checklist in section 4 instead of creating the same resources again through CLI commands. Local CLI authentication is still needed later for this guide's laptop tunnel.

Open PowerShell in `E:\Github\pi`. The prepared CLI is repository-local; authentication is an interactive step you complete yourself.

```powershell
. .\.artifacts\env.ps1
gcloud auth login
```

Finish the browser sign-in and wait for the PowerShell prompt to return. Then set the values for your deployment:

```powershell
$ProjectId = 'poetic-torch-514304-j4'
$Region = 'us-central1'
$Zone = 'us-central1-c'
$VmName = 'pi-collab-demo'
$DataDisk = 'pi-collab-data'
$Network = 'pi-collab-net'
$Subnet = 'pi-collab-subnet'
$OperatorEmail = 'YOUR_GOOGLE_ACCOUNT_EMAIL'
```

If creating a new project, run this once, then link billing in the Console. Skip it for an existing project:

```powershell
gcloud projects create $ProjectId --name='Pi collaboration take-home'
```

After billing is linked:

```powershell
gcloud config set project $ProjectId
gcloud services enable compute.googleapis.com iap.googleapis.com oslogin.googleapis.com --project=$ProjectId
```

The setup operator needs permission to enable APIs, create Compute/network/disk resources, and grant project roles. Use your authorized project administrator account; do not solve missing access by granting an evaluator Owner. An administrator grants these login roles to the operator:

```powershell
gcloud projects add-iam-policy-binding $ProjectId --member="user:$OperatorEmail" --role=roles/iap.tunnelResourceAccessor
gcloud projects add-iam-policy-binding $ProjectId --member="user:$OperatorEmail" --role=roles/compute.osAdminLogin
gcloud projects add-iam-policy-binding $ProjectId --member="user:$OperatorEmail" --role=roles/compute.viewer
```

OS Admin Login supplies administrator SSH access. For another person who needs their own tunnel, use OS Login without admin privileges, IAP tunnel access, and required Compute read access; organization/external-user policies can require additional approval. A person watching your screen needs no GCP login. App tokens remain a separate requirement. [OS Login role requirements](https://docs.cloud.google.com/compute/docs/oslogin/set-up-oslogin).

## 4. Laptop PowerShell: network, disks, and VM

### Console alternative: create or inspect the VM

If you already created the VM, inspect/edit that VM; do not create a duplicate. Use **Compute Engine → VM instances → your VM → Edit**, and the relevant network/IAM pages:

1. Use Debian 12 on x86-64 with a 50-GB balanced boot disk. The initial sizing proposal is 4 vCPUs/16 GB RAM; 2 vCPUs/16 GB can run the app but may make builds and CPU Ollama inference slower. Record the actual machine type.
2. Under **Additional disks**, create/attach a **blank 30-GB balanced persistent disk** named `pi-collab-data`. Keep it when the VM is deleted. Set its device name to `pi-collab-data` if offered, then verify the actual Linux device mapping in section 5. A disk's resource name alone does not guarantee its device name.
3. Record the actual zone and VM name. The VM name is arbitrary; subsequent commands must match it. Our current VM is `pi-collab-demo` in `us-central1-c`.
4. Set **Service account: None** for this app, and enable OS Login through the VM's metadata (`enable-oslogin=TRUE`) if following the guide's OS Login access model. These settings are not established merely by successful browser SSH.
5. Review the VM's VPC firewall. For the IAP tunnel, permit TCP 22 from `35.235.240.0/20` to this VM, for example using a `pi-collab` target tag. Keep ports 4310 and 11434 closed to public inbound traffic. Audit existing broad SSH rules; adding an IAP-only rule does not restrict another rule that already permits access.
6. Save and connect using the VM's **SSH** button. This opens the Linux terminal for section 5. Browser SSH access alone does not prove that the laptop's IAP tunnel permissions/firewall are ready.

See Google's [Console disk procedure](https://docs.cloud.google.com/compute/docs/disks/add-persistent-disk) and [SSH-in-browser documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-in-browser).

### CLI alternative: new resources only

Create a dedicated network rather than depending on a project's possibly absent or permissive default network:

```powershell
gcloud compute networks create $Network --subnet-mode=custom --project=$ProjectId
gcloud compute networks subnets create $Subnet --network=$Network --region=$Region --range=10.70.0.0/24 --project=$ProjectId
gcloud compute firewall-rules create pi-collab-iap-ssh --network=$Network --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=pi-collab --project=$ProjectId

gcloud compute disks create $DataDisk --zone=$Zone --size=30GB --type=pd-balanced --project=$ProjectId
gcloud compute instances create $VmName `
  --project=$ProjectId --zone=$Zone `
  --machine-type=e2-standard-4 `
  --image-family=debian-12 --image-project=debian-cloud `
  --boot-disk-size=50GB --boot-disk-type=pd-balanced `
  --network=$Network --subnet=$Subnet --tags=pi-collab `
  --metadata=enable-oslogin=TRUE `
  --no-service-account --no-scopes `
  --disk="name=$DataDisk,device-name=pi-collab-data,mode=rw,auto-delete=no"
```

The VM intentionally has no attached Google service account: the agent does not need ambient GCP API credentials. The separate disk is retained when the VM is deleted, so it also needs separate cleanup. The OS image family resolves at creation time; record the resulting image/revision for your evidence. [VM creation flags](https://docs.cloud.google.com/sdk/gcloud/reference/compute/instances/create), [persistent disk creation](https://docs.cloud.google.com/compute/docs/disks/add-persistent-disk).

Connect to the VM:

```powershell
gcloud compute ssh $VmName --project=$ProjectId --zone=$Zone --tunnel-through-iap
```

Everything in the next five sections runs in the VM's **Linux Bash terminal**, not laptop PowerShell.

## 5. VM Bash: tools and a mounted data directory

```bash
set -euo pipefail
sudo apt-get update
sudo apt-get install -y git curl ca-certificates xz-utils zstd rsync util-linux e2fsprogs less nano
```

For a first installation, create the service account below. If resuming, run `id pi-collab` first and skip `useradd` if it already exists:

```bash
sudo useradd --system --user-group --home-dir /var/lib/pi-collab-home --shell /usr/sbin/nologin pi-collab
sudo install -d -m 0700 -o pi-collab -g pi-collab /var/lib/pi-collab-home
cat /etc/os-release
uname -m
free -h
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
ls -l /dev/disk/by-id/google-*
readlink -f /dev/disk/by-id/google-pi-collab-data
```

Confirm `x86_64` for the Node archive below. If the data-device link is missing, identify the newly attached disk using the listing and Console details before substituting its actual path. Do not guess `/dev/sdb`, or format the boot disk. If no additional disk appears, finish section 4's disk attachment first.

**Format only the new, empty data disk created above.** Confirm its device mapping and size in `lsblk`; never format the boot disk or a disk containing a previous demo. The next block refuses a recognized existing filesystem, but that is not a substitute for checking the correct disk:

```bash
DATA_DEVICE=/dev/disk/by-id/google-pi-collab-data
test -b "$DATA_DEVICE"
if sudo blkid "$DATA_DEVICE"; then
  printf 'Existing signature found: stop and inspect; do not format.\n' >&2
  exit 1
fi
sudo mkfs.ext4 -m 0 -L pi-collab-data "$DATA_DEVICE"
sudo install -d -m 0755 /var/lib/pi-collab
DATA_UUID=$(sudo blkid -s UUID -o value "$DATA_DEVICE")
printf 'UUID=%s /var/lib/pi-collab ext4 defaults,nofail 0 2\n' "$DATA_UUID" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /var/lib/pi-collab
findmnt /var/lib/pi-collab
sudo chown pi-collab:pi-collab /var/lib/pi-collab
sudo chmod 0700 /var/lib/pi-collab
```

The UUID entry makes the mount persistent. `nofail` lets the VM boot without that disk; the application's mount guard must still refuse startup when it is missing. Do not rerun the formatting or append another fstab entry on a later login. [Google's Linux disk/mount procedure](https://docs.cloud.google.com/compute/docs/disks/format-mount-disk-linux).

Install the Linux version of the prepared Node release, checking the downloaded archive:

```bash
NODE_VERSION=v22.23.4
NODE_ARCHIVE="node-${NODE_VERSION}-linux-x64.tar.xz"
mkdir -p "$HOME/pi-install"
cd "$HOME/pi-install"
curl -fSLO "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"
curl -fSLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
grep " ${NODE_ARCHIVE}$" SHASUMS256.txt | sha256sum --check -
sudo test ! -e /opt/node
sudo install -d -m 0755 /opt/node
sudo tar -xJf "$NODE_ARCHIVE" -C /opt/node --strip-components=1
export PATH="/opt/node/bin:$PATH"
node --version
npm --version
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); db.close(); console.log('SQLite available')"
```

**The Node archive includes npm; no separate Debian npm installation is needed.** If `npm` is not found, check `ls /opt/node/bin/node /opt/node/bin/npm` and activate the path. Use `export PATH="/opt/node/bin:$PATH"` in each new SSH terminal, or add that non-secret line to your own `~/.profile`. Do not put provider keys there. This pin matches the local project's Node version; a later upgrade needs its own verification. [Official Node 22.23.4 release](https://nodejs.org/en/blog/release/v22.23.4).

An experimental SQLite warning on Node 22 is different from a missing `node:sqlite` module; the warning alone does not mean the check failed.

## 6. VM Bash: install the reviewed fork and build

These commands assume `/opt/pi` does not already contain a deployment. The checkout belongs to your operator user for installation/tests; the service runs as the separate `pi-collab` account with read-only code access.

```bash
umask 022
sudo test ! -e /opt/pi
sudo install -d -m 0755 -o "$USER" -g "$(id -gn)" /opt/pi
git clone YOUR_FORK_CLONE_URL /opt/pi
cd /opt/pi
```

**Select the source before installing dependencies.** For this project, the feature branch is `dev`:

```bash
git status --short --branch
git switch dev
git branch --show-current
git rev-parse HEAD
```

Stop if Git reports conflicting local changes; do not discard them. If `dev` is already checked out, leave it there. For a pinned presentation release, use a specific reviewed commit instead of the branch:

```bash
git checkout --detach YOUR_REVIEWED_COMMIT
git rev-parse HEAD
```

Replace `YOUR_REVIEWED_COMMIT` with the actual hash; do not run the placeholder literally. `checkout --detach` selects that exact version without following a branch. `rev-parse HEAD` records which version is deployed. Cloning/pushing a branch does not include uncommitted laptop changes.

**Install and build** from `/opt/pi`:

```bash
test -f packages/durable/src/collaboration/index.ts
npm ci --ignore-scripts --no-audit --no-fund

mkdir -p .artifacts
CATALOG_REVISION=$(node -p "JSON.parse(require('node:fs').readFileSync('nix/model-catalog.json','utf8')).revision")
curl -fSL "https://pi.dev/api/models/revisions/${CATALOG_REVISION}?types=chat,image,classifier" -o .artifacts/models.all.json
printf '%s  %s\n' "${CATALOG_REVISION#sha256-}" .artifacts/models.all.json | sha256sum --check -
node --conditions=source --experimental-strip-types packages/ai/scripts/hydrate-model-catalog.ts .artifacts/models.all.json
npm run build:offline
cd /opt/pi/apps/collab-demo
npm run check
npm run build
```

The catalog is pinned by the checked-out repository; do not refresh it to a different live revision just to get a build. Hydration writes ignored provider data, not a manually edited model catalog. The offline build then avoids catalog refresh. Package lifecycle scripts remain disabled. If this fresh Linux installation exposes a native-package/build issue, record it rather than claiming the local Windows build verified Linux. [Environment details](TAKE_HOME_ENVIRONMENT.md).

For a private fork, authenticate Git privately using your normal reviewed method; do not embed a personal access token in the clone URL or copy your entire developer home to the VM.

**If npm reports `EACCES` creating `/opt/pi/node_modules`:** the checkout must belong to your SSH operator, not root. Correct only this checkout's ownership, then retry npm without `sudo`:

```bash
sudo chown -R "$(id -un):$(id -gn)" /opt/pi
cd /opt/pi
npm ci --ignore-scripts --no-audit --no-fund
```

**If you selected `dev` late:** before the first service start, repeat this section's dependency installation, catalog hydration, root offline build, and app check/build on the correct source. Node, disk formatting, and Ollama installation need not be repeated. Preserve existing `/etc/pi-collab/host.env` keys/tokens; compare `config.json` with the selected branch's example and rerun preflight. If the app has already been started, follow section 12's idle-stop/old-writer checks before changing the checkout or dependencies, and preserve its store/configuration.

## 7. VM Bash: run Ollama for the mixed default

The Windows portable `ollama.exe` is not usable on this VM. Use the official Linux installer, selecting the recorded version rather than silently using latest:

```bash
cd "$HOME/pi-install"
curl -fsSL https://ollama.com/install.sh -o ollama-install.sh
```

**Run individually: inspect the installer.**

```bash
less ollama-install.sh
```

Press **Q** to return to the terminal. Text beginning `#!/bin/sh` is the installer script, not the settings file. Do not paste configuration into this viewer.

**Run in the terminal after leaving the viewer:**

```bash
sudo env OLLAMA_VERSION=0.40.15 sh ./ollama-install.sh
sudo install -d -m 0755 /etc/systemd/system/ollama.service.d
```

`No NVIDIA/AMD GPU detected ... CPU-only mode` is expected on a VM without a supported GPU. It is not an installation failure. Measure model latency before the presentation; OpenAI inference is unaffected because it runs remotely.

**Run individually: open the settings editor.**

```bash
sudo nano /etc/systemd/system/ollama.service.d/pi-demo.conf
```

**Paste into editor:** for a new file, the entire contents should be this block, with `[Service]` on the first line. If it already has intentional settings, preserve them and update/add these entries under `[Service]` without duplicating the same variables.

```ini
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NO_CLOUD=1"
```

**Save/exit:** press **Ctrl+O**, **Enter**, then **Ctrl+X**. If you accidentally pasted shell commands into this file, remove those lines before saving. At Nano's `File Name to Write` prompt, **Ctrl+C** returns to editing. If using `sudoedit` instead, its temporary `/var/tmp/...conf` filename is normal: save to that unchanged filename and exit so it copies back.

**Run only after the normal terminal prompt returns:**

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama.service
sudo systemctl status ollama.service --no-pager
ollama --version
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama list
curl --fail --silent --show-error http://127.0.0.1:11434/api/tags
```

Record the actual model digest, not just its mutable tag. The listing proves availability, **not successful tool use**; verify actual files through the app before rehearsal. CPU inference may be slow, and one inference slot is intentional. If a pinned Linux artifact is unavailable, stop and select/retest an explicit version. [Official Linux installation instructions](https://github.com/ollama/ollama/blob/main/docs/linux.mdx), [Ollama environment configuration](https://docs.ollama.com/faq), [project local-model evidence](apps/collab-demo/LOCAL_MODELS.md).

The app service does not wait for an Ollama readiness probe. Check the backend separately after reboot and before rehearsal; preflight only checks declarations.

Ollama's own service/model cache is separate from the app data directory. Replacing the VM requires reinstalling/re-pulling it or preserving its cache separately; it is not part of the app's stopped-store backup.

## 8. VM Bash: configuration, secrets, and preflight

Keep configuration and secrets outside the checkout/workspace. The first two files below must be new; do not overwrite a previous deployment's credentials:

```bash
cd /opt/pi
sudo install -d -m 0750 -o root -g pi-collab /etc/pi-collab
sudo test ! -e /etc/pi-collab/config.json
sudo test ! -e /etc/pi-collab/host.env
sudo install -m 0640 -o root -g pi-collab apps/collab-demo/config.example.json /etc/pi-collab/config.json
sudo install -m 0600 -o root -g root apps/collab-demo/deploy/host.env.example /etc/pi-collab/host.env
```

Generate Alice/Bob tokens directly into that private file without printing them:

```bash
cat > /opt/pi/.artifacts/prepare-host-tokens.mjs <<'JS'
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const path = '/etc/pi-collab/host.env';
let contents = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
for (const name of ['COLLAB_TOKEN_ALICE', 'COLLAB_TOKEN_BOB']) {
  contents = contents.replace(new RegExp(`^${name}=$`, 'm'), `${name}=${randomBytes(24).toString('base64url')}`);
}
writeFileSync(path, contents, { mode: 0o600 });
JS
sudo /opt/node/bin/node /opt/pi/.artifacts/prepare-host-tokens.mjs
```

**Run individually: open the private editor.**

```bash
sudoedit /etc/pi-collab/host.env
```

**Edit the file, not the terminal:** fill `OPENAI_API_KEY` and confirm the following entries (add the Ollama URL if missing):

```dotenv
COLLAB_CONFIG=/etc/pi-collab/config.json
COLLAB_DATA=/var/lib/pi-collab
COLLAB_PORT=4310
COLLAB_OLLAMA_URL=http://127.0.0.1:11434/v1
```

Save and exit before running preflight. If `sudoedit` opens Nano, use **Ctrl+O**, **Enter**, **Ctrl+X**, leaving its temporary filename unchanged. Do not paste the subsequent preflight command into the secrets file. When resuming an installation, preserve existing keys/tokens instead of recopying the templates or regenerating credentials.

Keep the generated token lines. They are browser passwords; retrieve them privately before screen-sharing. `CODEX_BIN` may remain unused for this native-only composition. This is a **systemd EnvironmentFile**, so use `NAME=value`, not `export`, and do not source it into an administrator shell. The unit loads it on every start; the app's local `.env` is not needed.

The copied config selects agent IDs `openai` and `ollama`, with `gpt-5.4-mini` and the Qwen3 model above. If deliberately choosing two hosted agents instead, edit this private JSON **before first startup**. Changing stored members/agents/models requires a fresh store and a deliberate unit/mount plan later, not deleting the existing database.

Run read-only preflight under the service identity/environment:

```bash
sudo systemd-run --unit=pi-collab-preflight --collect --wait --pipe \
  --property=User=pi-collab --property=Group=pi-collab \
  --property=WorkingDirectory=/opt/pi/apps/collab-demo \
  --property=EnvironmentFile=/etc/pi-collab/host.env \
  --setenv=HOME=/var/lib/pi-collab-home \
  --setenv=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin \
  /opt/node/bin/node --conditions=source --experimental-strip-types src/preflight.ts
```

Expected: `configuration-valid`, two members, the selected agents, and an empty `missingKeys` list. It opens no runtime store and makes no model request. It does not establish valid API credit, Ollama readiness, tool quality, disk permissions, or process containment.

## 9. VM Bash: install and start the app service

```bash
sudo install -m 0644 /opt/pi/apps/collab-demo/deploy/pi-collab.service /etc/systemd/system/pi-collab.service
sudo systemd-analyze verify /etc/systemd/system/pi-collab.service
sudo systemctl daemon-reload
sudo systemctl start pi-collab.service
```

**Check readiness separately after startup** (the process can be `active` before it has opened its port):

```bash
sudo systemctl status pi-collab.service --no-pager
sudo ss -ltnp '( sport = :4310 or sport = :11434 )'
curl --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' http://127.0.0.1:4310/
```

Expected: service `active (running)`, both listeners on `127.0.0.1`, and `HTTP 200`. If an immediate check shows only Ollama's port, repeat the readiness checks after a few seconds. Do not treat preflight's `status=0/SUCCESS` alone as app readiness. The Node SQLite experimental warning is informational. `disabled` in the service status means boot startup is not enabled; that is intentional until acceptance checks pass.

These checks establish web-server startup, not working provider credentials or model tool use. Inspect failures privately with:

```bash
sudo journalctl -u pi-collab.service -n 60 --no-pager
sudo journalctl -u ollama.service -n 60 --no-pager
findmnt /var/lib/pi-collab
```

The template uses prebuilt browser assets and direct Node execution. Do not replace it with `npm start`: that command rebuilds assets and is inappropriate under the unit's read-only code policy. Do not run another manual owner against `/var/lib/pi-collab`. `Restart=no` is intentional; do not hide uncertain failures with an automatic restart loop. All agent tools still run with the service user's access, including access to its environment; this is not a hostile-user sandbox.

## 10. Laptop PowerShell: open the GCP app

**Run on your Windows laptop, not in browser SSH.** Open a separate PowerShell terminal, activate the prepared tools, and set the actual project/zone/VM. Repeating `$ProjectId` is necessary in a new terminal because variables do not carry into a new window; the same terminal can reuse existing correct values.

```powershell
Set-Location E:\Github\pi
. .\.artifacts\env.ps1
$ProjectId = 'poetic-torch-514304-j4'
$Zone = 'us-central1-c'
$VmName = 'pi-collab-demo'
```

If this laptop has not been authenticated, run `gcloud auth login` individually and finish its browser sign-in before continuing. Browser SSH authentication does not automatically authenticate the laptop CLI.

**Run this command as one line, then keep the connection open:**

```powershell
gcloud compute ssh $VmName --project=$ProjectId --zone=$Zone --tunnel-through-iap --ssh-flag="-N" --ssh-flag="-L 14310:127.0.0.1:4310"
```

Use explicit `--ssh-flag` arguments on PowerShell; the previous trailing `-- -N -L ...` form was not passed through correctly in this setup. These forwarding options work with the SSH clients' common `-N`/`-L` syntax; OpenSSH-only `-o` settings are omitted because Windows gcloud may select PuTTY. `-N` means no remote shell, so a quiet terminal or open SSH window can be normal. Read any authentication, forwarding, or host-key prompts before proceeding. See [gcloud's SSH flag reference](https://docs.cloud.google.com/sdk/gcloud/reference/compute/ssh).

Open **`http://127.0.0.1:14310`** in two browser profiles. Sign in as Alice and Bob using the private tokens. Laptop port 14310 forwards to VM port 4310, avoiding the usual local-demo port. This does not change the app's `COLLAB_PORT`. Close the SSH connection to end the tunnel.

If forwarding reports a port conflict, use another unused laptop port in the `-L` argument and browser URL. Check that the selected port has no existing listener before connecting:

```powershell
Get-NetTCPConnection -LocalPort 14310 -State Listen -ErrorAction SilentlyContinue
```

No output before connecting means there is no current listener. Do not assume an old local page proves the tunnel succeeded. Tunnel/browser success is not yet recorded for this VM. [IAP SSH connection guidance](https://docs.cloud.google.com/compute/docs/connect/ssh-using-iap).

## 11. Demonstrations and exact commands

Use the browser for shared work, observed native tool activity, file inspection and the new controlled conflict panel. Use the VM terminal for deterministic races, recovery tests and load evidence; there is no performance dashboard. **The conflict/activity increment is implemented locally but is not yet verified on this VM.**

### Updating the existing VM for the new GUI

First review, commit and push the local changes to your fork yourself; cloning/fetching cannot deploy uncommitted laptop files. No assistant commit/push or VM change has been performed. Then:

1. Wait for both live agents to be idle. Follow section 12's service-stop and old-writer checks; retain a stopped-store backup before an upgrade. Do not change code/dependencies under a running owner.
2. In **VM Bash**, inspect the checkout and fetch the published branch:

   ```bash
   export PATH="/opt/node/bin:$PATH"
   cd /opt/pi
   git status --short --branch
   git fetch origin dev
   ```

3. If the checkout has local changes, stop and review them; do not reset/stash them. Select the actual reviewed commit containing these features:

   ```bash
   git checkout --detach YOUR_REVIEWED_COMMIT
   git rev-parse HEAD
   ```

4. Repeat section 6's dependency installation/catalog hydration if its inputs changed. Build the workspace and browser (the new tool projection is package code, so an app-only build is insufficient):

   ```bash
   npm run build:offline
   cd /opt/pi/apps/collab-demo
   npm run check
   npm run build
   ```

5. Preserve `/etc/pi-collab/host.env`, tokens, fixed agent configuration and the main data store. Start using `sudo systemctl start pi-collab.service`, then repeat section 9's port/HTTP checks. The existing unit can write the new scenario under `/var/lib/pi-collab/conflict-demo`; no new firewall rule, model key or agent configuration is required.
6. Keep/reopen the laptop tunnel and reload both browser profiles. Assets are read once at host startup, so page refresh without host restart does not deploy a new build. Sign in and open **Shared-file conflict · Controlled demonstration**.

### Browser: controlled conflict without racing models

Follow the [two-user walkthrough](apps/collab-demo/README.md#show-a-concrete-conflict-and-its-resolution): both prepare, Alice publishes, Bob publishes his stale edit, then Bob reviews/submits the explicit resolution. Both users see current bytes and retained proposals, including after reconnect. The panel refreshes every two seconds only while open.

This is actual ManagedFile/SQLite/filesystem behavior with **scripted proposals**, not real model-controlled writes. Its separate file is `/var/lib/pi-collab/conflict-demo/workspace/shared.txt`; it is not the main agents' workspace. There is one saved walkthrough with retry-safe steps and no reset route. Ordinary OpenAI/Ollama tools, shell commands and Codex still bypass managed protection. Panel actions call no provider; the live host still requires its normal startup configuration. The whole-data-directory backup includes this separate scenario store/file.

| Demonstration | Where | Key/model requirement | What it proves |
| --- | --- | --- | --- |
| Shared users, files, reconnect | Browser through tunnel | Running configured OpenAI/Ollama | Real tool integration and shared state |
| Six user/agent pairs, same-agent queue, stale overwrite | Isolated app tests on VM | None | Controlled coordination/race assertions |
| Managed conflict and explicit resolution | Standalone example 41 on VM | None | Opt-in package protection, not live tool protection |
| Controlled conflict panel | Browser, after deploying the new increment | No model call for panel actions | Authenticated scripted proposals, stale refusal, retained evidence and explicit resolution on an isolated file |
| Same-ID retry and changed-text rejection | VM HTTP client below | One accepted native command can spend model tokens | HTTP acceptance/deduplication behavior |
| Crash/recovery boundaries | Isolated Durable tests on VM | None | Selected fixture crashes, not arbitrary process containment |
| Burst/soak load | Isolated load runner on VM | None | Real SQLite/HTTP/SSE with simulated execution |

### A. Browser: four pairings and actual files

Use a disposable presentation workspace and paste these prepared instructions:

1. **Alice → openai:** `Use the write tool once to create alice.txt containing exactly ALICE-ONE. Then reply DONE.`
2. **Bob → openai:** `Use the edit tool once on alice.txt to replace ALICE-ONE with ALICE-TWO. Then reply DONE.`
3. **Bob → ollama:** `Use the write tool once to create bob.txt containing exactly BOB-ONE. Then reply DONE.`
4. **Alice → ollama:** `Use the read tool on bob.txt, then reply with only its contents.`

Inspect `alice.txt` and `bob.txt` in **Workspace files · Read only**, using manual Refresh. Expected final bytes: `ALICE-TWO` and `BOB-ONE`. Closing Alice's page does not cancel accepted work; let Bob observe completion, then reopen/relogin as Alice and inspect saved history. Do not resubmit just to restore the view.

If step 1 finishes before Bob submits, that live run did not show a queue. Use B's deterministic queue test rather than claiming you saw overlap. Likewise, only use Stop on rehearsed disposable work: it affects the whole selected agent and does not undo file changes. [GUI guarantees](llm-wiki/06-web-and-demonstration.md#what-the-current-gui-can-prove).

### B. VM Bash: deterministic M:N, queueing, and lost update

These tests create their own runtime/servers and temporary files; no running demo server or provider keys are required. Run as your checkout-owning SSH user, not as the protected app service:

```bash
export PATH="/opt/node/bin:$PATH"
cd /opt/pi/apps/collab-demo
node /opt/pi/node_modules/vitest/dist/cli.js --run test/concurrency.test.ts
```

Expected: three passing cases. They verify six user/agent pairings, a same-agent `running`/`queued` ordering, and a forced stale overwrite ending in `base|bob` after Alice's change was erased. The test assertions establish the controlled ordering; a PASS line is not a visual GUI conflict walkthrough. [Test source](apps/collab-demo/test/concurrency.test.ts), [lost-update explanation](llm-wiki/04-files-and-conflicts.md#the-lost-update-example-to-remember).

To show just the overwrite case:

```bash
node /opt/pi/node_modules/vitest/dist/cli.js --run test/concurrency.test.ts -t 'lost update'
```

### C. VM Bash: protected edit, retained conflict, explicit resolution

```bash
cd /opt/pi/packages/durable
node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
```

Expected output includes Alice applied, Bob conflict, `Current (Alice preserved): base + alice`, a successful resolution, and retained proposal evidence. The example explicitly supplies `base + alice + bob` as the resolution. It uses actual temporary files with scripted participants and cleans them up; there is no model call or automatic merge. **Normal browser agents do not use this managed API yet.**

For a second standalone coordination example with actual SQLite and simulated native/external agents:

```bash
node --conditions=source --experimental-strip-types test/examples/38-collaborative-thread.ts
```

It shows shared files, a stable receipt retry, and Bob observing Alice's lane, independently of the live service. [Managed-file explanation](llm-wiki/04-files-and-conflicts.md#managed-publication-and-optimistic-concurrency-control).

### D. VM Bash: same-ID retry over the actual HTTP API

This optional client targets the running **live** service, thread `project`, agent `openai`. It submits one new logical instruction, repeats the same ID/text, then tries changed text under that ID. The token is read privately into memory, not placed in command-line arguments.

```bash
mkdir -p "$HOME/pi-collab-evidence"
cat > "$HOME/pi-collab-evidence/retry-demo.mjs" <<'JS'
const token = process.env.COLLAB_DEMO_TOKEN;
const id = process.argv[2];
if (!token || !id) throw new Error('Provide a private Alice token and a request ID');
const url = 'http://127.0.0.1:4310/api/threads/project/agents/openai/commands';
const text = 'Reply with only RETRY-DEMO. Do not use tools or change files.';
for (const [label, instruction, expected] of [
  ['first send', text, 202],
  ['same-ID retry', text, 202],
  ['same ID with changed text', 'This is different text.', 409],
]) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text: instruction }),
  });
  console.log(label, response.status, await response.json());
  if (response.status !== expected) throw new Error(`Expected ${expected}`);
}
JS
```

**Run individually:** the next command waits for you to paste Alice's token privately and press Enter; characters are not displayed. Do not paste the remaining commands while that prompt is active.

```bash
read -rs -p 'Alice token (private; not echoed): ' COLLAB_DEMO_TOKEN
```

**After the terminal prompt returns:**

```bash
printf '\n'
export COLLAB_DEMO_TOKEN
node "$HOME/pi-collab-evidence/retry-demo.mjs" "presentation-retry-$(date +%s)"
unset COLLAB_DEMO_TOKEN
```

Expected HTTP statuses: **202, 202, 409**. The two accepted replies identify the same user/agent/request, and changed text is refused. Inspect the corresponding instruction in Alice's shared agent history. This proves duplicate-safe **admission**, not a general exactly-once model/file guarantee. If retrying after a genuinely lost reply, preserve that original ID; do not generate a timestamped new ID. Use a new ID for a deliberate new run. [Retry scope](llm-wiki/02-commands-and-concurrency.md#retry-identity-and-idempotent-admission).

### E. VM Bash: selected crash/recovery scenarios

```bash
cd /opt/pi/packages/durable
node /opt/pi/node_modules/vitest/dist/cli.js --run test/collaboration-recovery.test.ts test/collaboration-boundaries.test.ts
```

These use controlled fixture processes, temporary stores, and simulated model/driver behavior. They do not kill the presentation service or require real Codex/OpenAI calls. Record their actual Linux result; Windows passes do not prove Linux containment. Do not add the deferred slow native Bash case or raise runner timeouts and call that a fix. [Recovery interpretation](llm-wiki/03-durability-and-recovery.md).

### F. VM Bash: smoke or full soak load

Run outside the live service's store. The runner creates independent temporary SQLite stores and HTTP servers, then removes them; its output path is retained:

```bash
mkdir -p "$HOME/pi-collab-evidence"
cd /opt/pi/apps/collab-demo
node --conditions=source --experimental-strip-types load/run.ts 5 "$HOME/pi-collab-evidence/load-smoke.json"
```

For the approximately ten-minute soak instead:

```bash
node --conditions=source --experimental-strip-types load/run.ts 600 "$HOME/pi-collab-evidence/load-soak.json"
```

The short run still includes baseline and burst phases; it is not a five-second end-to-end deadline or soak evidence. Both modes use **simulated agent execution over real SQLite/HTTP/SSE**, not hosted-model throughput. Running load on the same VM can slow the live demo, so do it outside presentation time. Read the [workload/report](apps/collab-demo/load/README.md) before interpreting counts, latency, or memory.

Copy a retained report to the laptop from **laptop PowerShell**:

```powershell
gcloud compute scp "${VmName}:~/pi-collab-evidence/load-smoke.json" .artifacts/gcp-load-smoke.json --project=$ProjectId --zone=$Zone --tunnel-through-iap
```

## 12. Idle restart, backup, and acceptance record

Before stopping the app, wait for both lanes to be idle. In **VM Bash**:

```bash
sudo systemctl stop pi-collab.service
sudo systemctl show pi-collab.service --property=ActiveState --property=SubState --property=ControlGroup
if ! sudo systemd-cgls /system.slice/pi-collab.service; then
  printf 'No cgroup listing: confirm it is absent, or diagnose the inspection failure, before proceeding.\n'
fi
```

An absent cgroup can be expected after a complete stop. Confirm no former app/child writer remains; a closed port alone is insufficient. If shutdown is uncertain, inspect rather than starting another owner. An idle restart demonstrates narrower behavior than active crash recovery.

For a stopped-store backup, after that check:

```bash
sudo install -d -m 0700 /var/backups/pi-collab
ARCHIVE="/var/backups/pi-collab/demo-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
sudo bash /opt/pi/apps/collab-demo/deploy/backup.sh /var/lib/pi-collab "$ARCHIVE"
sudo tar --list --gzip --file="$ARCHIVE"
sudo systemctl start pi-collab.service
```

Reconnect browsers and inspect the same messages/files without resubmitting. The archive contains the full stopped data directory, including workspace and SQLite sidecars; credentials/configuration and the Ollama cache are separate. A backup on the same VM is only a staging copy: move it to private storage before deleting that VM. Treat it as sensitive and do not expose its contents during presentation.

To retrieve the archive, first stage a private copy owned by your SSH user on the VM:

```bash
mkdir -p "$HOME/pi-collab-evidence"
sudo install -m 0600 -o "$USER" -g "$(id -gn)" "$ARCHIVE" "$HOME/pi-collab-evidence/$(basename "$ARCHIVE")"
```

Then use laptop PowerShell, replacing the timestamp with the actual archive name:

```powershell
gcloud compute scp "${VmName}:~/pi-collab-evidence/demo-YYYYMMDDTHHMMSSZ.tar.gz" .artifacts/ --project=$ProjectId --zone=$Zone --tunnel-through-iap
```

Record these checks in your deployment evidence:

- Exact fork commit, Linux image, Node/Ollama versions, model digest, zone/machine, and actual configuration.
- Two-user browser/file demonstration and separate key-free scenario results.
- Successful idle reopen; verified old-writer cleanup before ownership replacement.
- Persistent mount after reboot and refusal to start with the mount missing.
- Restore into an isolated stopped installation using the same configuration and absolute workspace path.
- Separate authenticated Codex turn/continuation **only if you choose that optional harness**; a native OpenAI success or CLI initialization does not establish it.

Test reboot/missing-mount/restore outside the live presentation, following the [technical runbook](apps/collab-demo/deploy/README.md#evaluator-access-and-acceptance-checks). Only after those service checks should you enable boot startup with `sudo systemctl enable pi-collab.service`; this leaves `Restart=no` unchanged.

## 13. Troubleshooting

| Symptom | Check first |
| --- | --- |
| IAP/SSH denied | Active Google account/project, IAP and OS Login roles, VM metadata, tagged TCP-22 rule; organization policies |
| VM resource not found under `us-central1-a` | Current VM is in `us-central1-c`; correct `$Zone` in this PowerShell window. Check project/name too |
| `gcloud` rejects `-N`, `-L`, or `-o` | Use section 10's explicit `--ssh-flag` command; do not append bare SSH options |
| Browser shows an old local demo | Use laptop port 14310; ensure it was unused before opening the tunnel and inspect forwarding errors |
| `npm` command not found | Node archive includes npm; activate `export PATH="/opt/node/bin:$PATH"` in the current VM terminal |
| npm cannot create `/opt/pi/node_modules` (`EACCES`) | Correct checkout ownership using section 6; retry npm as the SSH operator, without `sudo` |
| Wrong branch discovered after installation | Select `dev`, reinstall deps, rehydrate catalog and rebuild; preserve secrets/store and rerun preflight. Stop an existing service before changing its code |
| Viewer shows `#!/bin/sh` instead of settings | You are inspecting `ollama-install.sh` in `less`; press Q, finish installation, then open the separate `.conf` file |
| Nano contains `systemctl`/`ollama pull` commands | Cancel the save prompt with Ctrl+C; remove accidental shell commands, enter only the configuration, save and exit before running terminal commands |
| Ollama warns no GPU was detected | Expected CPU-only mode on this VM; test actual latency rather than treating the warning as installation failure |
| Service active but port 4310 absent immediately | Repeat readiness checks after initialization; if still absent, inspect app journal. Expected HTTP 200, not just successful preflight |
| Service skipped at startup | `findmnt /var/lib/pi-collab`; mount guard deliberately prevents fallback onto boot storage |
| `node:sqlite` missing | `node --version`, selected binary, and SQLite check; do not add a SQLite npm dependency |
| Missing provider data / `utils/*` exports | Hydrate the pinned catalog, run root offline build, then app build |
| Preflight passes but OpenAI fails | Account/key/model access and credits; preflight does not call OpenAI. Generic UI `model_error` may omit retained provider detail |
| Ollama connects but no files change | Correct pulled model/digest, app tool calls and actual file bytes; a DONE answer is not a content assertion |
| Config rejected on reopen | Changed fixed members/agents/models/workspace; preserve data and plan a fresh store, do not delete history |
| CLI example/test cannot write cache or report | Run as the checkout-owning operator; use your own writable evidence directory, not a second service owner |
| Fixture load passes but real agent is slow | Simulated service latency is not model/GPU/provider performance |

## 14. Teardown from laptop PowerShell

**Console alternative:** after exporting evidence/backups, delete the intended VM through **Compute Engine → VM instances** and inspect retained resources under **Disks**, snapshots/schedules, and networking. Delete only resources created for this deployment. A Console-created VM may not use the dedicated network/rule names below. Retained data disks need separate deletion; review snapshot policies and retained snapshots too.

First export evidence and private backups, stop the service/VM as appropriate, and close SSH tunnels. **Deletion commands below are destructive**; inspect project/name variables and keep the CLI confirmations. Run only when the demonstration and recovery checks are finished.

```powershell
gcloud compute instances delete $VmName --project=$ProjectId --zone=$Zone
gcloud compute disks list --project=$ProjectId
gcloud compute disks describe $DataDisk --project=$ProjectId --zone=$Zone
```

The data disk was configured not to auto-delete. After confirming you have any needed archive, delete that retained disk and the dedicated networking resources:

```powershell
gcloud compute disks delete $DataDisk --project=$ProjectId --zone=$Zone
gcloud compute firewall-rules delete pi-collab-iap-ssh --project=$ProjectId
gcloud compute networks subnets delete $Subnet --project=$ProjectId --region=$Region
gcloud compute networks delete $Network --project=$ProjectId
gcloud compute instances list --project=$ProjectId
gcloud compute disks list --project=$ProjectId
gcloud compute snapshots list --project=$ProjectId
gcloud compute addresses list --project=$ProjectId
```

Also review retained backups, snapshots, any separately added resources, IAM access, and provider/token revocation. Stopping or deleting a VM alone does not establish zero remaining charges. Do not delete unrelated resources in an existing shared project. [Disk deletion settings](https://docs.cloud.google.com/compute/docs/disks/modify-persistent-disk).

## Immediate next work

Complete the laptop IAP tunnel using the correct zone, verify two-user browser access and actual OpenAI/Ollama file-tool results, then record scenario tests and restart/backup acceptance on Linux. Startup alone does not establish those results. The current planned implementation remains the step-controlled conflict GUI, which needs no additional provider key or GCP. Hosted demonstrations need the configured OpenAI key and a ready VM-local model; optional live Codex needs separate authentication. The Windows Bash investigation remains deferred.
