# Collaborative Pi Durable presentation

A Moloch/LaTeX Beamer deck for an engineering interview: **14 main slides, ten minutes of planned cues, plus four backup slides**. Updated November 10, 2026 with a two-person handoff story, adjacent conflict problem/resolution slides and simpler speaker notes. Cloud website access is user-reported; the deployed revision, slow GCP Ollama chat and operational acceptance still need verification.

## Present or rehearse

- [Revised PowerPoint deck](output/collaborative-pi-durable-revised.pptx): compiled LaTeX slide images with **native editable speaker notes** for every slide. Open Presenter View to read the notes. The visual text/tables are not individual editable PowerPoint objects; edit `slides.tex` and rebuild to change them.
- [Revised slide PDF](output/collaborative-pi-durable-revised.pdf): vector LaTeX text/tables plus a labelled historical local screenshot.
- [Revised speaker notes PDF](output/speaker-notes-revised.pdf): one page per slide, with speaking points, examples, demonstrations and wiki references.
- [Readable speaker notes](speaker-notes.md): the same notes with clickable repository links.
- [LaTeX source](slides.tex) and [authoritative notes](notes.json): edit these and rebuild. Generated Markdown, PDF, and PowerPoint notes come from the same JSON.

The timings total **10 minutes**, before questions and unpredictable model latency. Rehearse the actual duration; this is a target, not a recorded human rehearsal. For a shorter slot, use recorded native-model evidence and prioritize the controlled conflict walkthrough. Backup slides are outside the main timing. Earlier unsuffixed outputs remain for comparison; use the `-revised` files for this version.

## Story and note format

The story starts with **Alice and Bob continuing the same agent conversation**, rather than an access matrix. Shared authorship, queueing and Stop explain the coordination introduced by a second person; another agent can review the same workspace with a separate history.

The sequence is **shared-user behavior → handoff demo → architecture and saved requests → activity → stale-edit problem and resolution → agent awareness → recovery → execution paths → evidence → deployment → next work**. Slides 7–8 keep the stale-edit trace beside its controlled demonstration. Slide 9 then explains why model awareness provides a separate, weaker protection.

Each `talking_points` entry in `notes.json` has a short `point` and a `details` list for examples or optional technical explanations. `demo` contains numbered steps. Brackets define terms where used—for example, external harness [separate agent application]. The Markdown, PDF and editable PowerPoint notes preserve this structure; read the main points aloud and use the details for preparation or questions.

## Demonstration plan

| Slides | What to show on an updated host | Boundary |
| --- | --- | --- |
| 2–3 | Alice starts work; Bob sees and continues it on the same agent; another agent inspects the same files | Historical screenshot is local Ollama, not the exact new handoff or GCP |
| 4–5 | Package boundaries; saved acceptance versus eventual answer; retry versus new Send | Identical text with a fresh request ID is another command |
| 6 | Activity receipts and saved native tool summaries, then inspect actual bytes | Bounded observations, not a full audit history or percent-complete estimate |
| 7–8 | Lost-update trace, then generate both proposals; publish Alice; refuse Bob; resolve and reset | Prepare live outputs beforehand if necessary and disclose it; ordinary coding writes bypass managed publication |
| 9 | Ollama writes, GPT changes, Ollama rereads | Awareness is guidance, not a lock; live interpretation remains to be rehearsed |
| 10 | Explain recovery; optionally rehearse idle restart separately | No exactly-once arbitrary file effects or claim of complete process containment |
| 11–12 | Native providers versus Codex; saved load report and selected test evidence | Two native providers do not establish real Codex operation; load used simulated execution |
| 13–14 | Cloud access versus remaining acceptance; next protection slice | User reports website access; no new assistant cloud verification or latency fix is claimed |

Every slide's notes contain speaking points, demo steps, fallback, claim boundary and wiki references. The panel retains up to **64 rounds** and permits each authenticated participant to generate/publish their own proposal. **Reset round for both users** restores defaults and a neutral file, closes old generation and rejects old-round actions. Normal coding histories/files stay intact; do not delete existing live data. Never run uncontrolled same-file races or destructive crash/load demonstrations against the presentation's active store.

## GCP access and evidence

Follow the [GCP guide](../../TAKE_HOME_GCP_DEPLOYMENT_GUIDE.md) and [technical runbook](../../apps/collab-demo/deploy/README.md). The initial service and HTTP 200 were shown by the user, but the latest revision must be deployed and verified before presenting these features on GCP. Private access from Windows uses PowerShell variables for the actual VM/project/zone:

```powershell
gcloud compute ssh $VmName --project=$ProjectId --zone=$Zone --tunnel-through-iap --ssh-flag="-N" --ssh-flag="-L 14310:127.0.0.1:4310"
```

Open `http://127.0.0.1:14310` in two browser profiles; it reaches the VM through the tunnel. The current VM zone is `us-central1-c`; a different VM may use a different zone. Public HTTPS instructions were also supplied for a reverse proxy and IP-based hostname, but this deck does not invent a working endpoint. Preserve token authentication and keep backend/model ports private. Keep credentials off screen, and never start a second owner against service-owned data.

Terminal fallback on a built VM, independent of the web server and model keys:

```bash
cd /opt/pi/packages/durable
node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
```

This uses temporary real files and scripted proposals. The web GUI now demonstrates the same managed API separately from ordinary agent writes.

## Rebuild

Requirements: Python 3.10+, **PyMuPDF 1.26.7**, **Tectonic 0.17.0** or a compatible Tectonic version, and the Moloch source clone. The full builder also requires **Windows PowerShell and installed Microsoft PowerPoint** for the PPTX wrapper. The first compilation can download standard LaTeX packages. Application dependencies, model keys, the demo server, and GCP are not needed to build this presentation.

The prepared tools are under the ignored repository `.artifacts/` folder. From the repo root, these are the exact commands used locally; choose another Python 3.10+ executable if the separate existing environment is unavailable:

```powershell
$PresentationPython = 'E:\Github\NimbleHackathon\.venv312\Scripts\python.exe'
$env:PYTHONPATH = 'E:\Github\pi\.artifacts\tools\presentation-python'
$env:TECTONIC_CACHE_DIR = 'E:\Github\pi\.artifacts\tools\tectonic-cache'
& $PresentationPython presentations/take-home/build.py `
  --moloch-source E:/Github/moloch `
  --tectonic E:/Github/pi/.artifacts/tools/tectonic-0.17.0/tectonic.exe `
  --output-suffix=-revised
```

For another Windows machine with PowerPoint, install the pinned renderer in a dedicated environment with `python -m pip install PyMuPDF==1.26.7`, download Tectonic from its official project, and pass that compiler and your Moloch clone paths. Python uses only its standard library plus PyMuPDF; a small PowerShell script calls the installed PowerPoint application to create the wrapper and notes. It does not use `python-pptx`, change root npm dependencies, or modify the cloned template. On another OS, the LaTeX/PDF sources remain usable, but this PowerPoint packaging step needs a Windows host.

The builder extracts the local theme into ignored `.build/`, compiles the slides and notes, checks for LaTeX overflow, and exports 16:9 slide images into the PPTX with per-slide notes. PowerPoint packaging happens without opening a presentation window, closes only the presentation it created, and preserves any existing open presentations. The shown suffix regenerates the three `-revised` outputs and `speaker-notes.md`; omit it only to replace the earlier unsuffixed outputs. Close the target deck before rebuilding it. Avoid editing generated files. The PPTX preserves the LaTeX appearance; tables/charts remain editable in the LaTeX source.

## References and provenance

- [Main wiki](../../llm-wiki/README.md), [terminology guide](../../llm-wiki/09-technical-terms.md), and [question bank](../../llm-wiki/interview-questions/README.md).
- [Original presentation runbook](../../TAKE_HOME_PRESENTATION.md) and [implementation/evidence record](../../TAKE_HOME_PROGRESS.md).
- Moloch clone: `E:\Github\moloch`, revision `8dc40b8bfcd9c8a2c8c4a3d4204daa80883d0527`, theme 2.3.1. [Upstream project](https://github.com/jolars/moloch). Theme authors include Johan Larsson and the Metropolis contributors; theme source is CC-BY-SA 4.0. Theme extraction is private and unmodified; this does not impose that license on the presentation content, per the upstream README.
- Beamer skill: `E:\Github\beamer-skill`, revision `f98a66bb1d3c5d93fa21a07c5151afedf2b1d535`. [Upstream skill](https://github.com/wenlzhang/beamer-skill), MIT; used as authoring guidance.
- Compiler: [official Tectonic 0.17.0 release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0); the Windows MSVC archive was verified against release SHA-256 `f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f`.
- UI asset: `assets/local-ollama-browser.png`, copied from the previously recorded local browser screenshot in `.artifacts/ollama-browser-desktop.png`. [Portable run record](../../apps/collab-demo/scripts/results/2026-11-08-ollama-browser.json). It contains no displayed login token or API key; it depicts local inference and is labelled accordingly.

- Additional UI asset: `assets/controlled-conflict-browser.png`, copied from the local scripted browser verification. Real SQLite/files, no model calls or GCP execution; no displayed credentials.

## Immediate next implementation

Rehearse and record real OpenAI/Ollama peer-edit interpretation, then implement trusted-context managed model tools/file-effect provenance if scope permits. Local scripted rehearsal needs no key or GCP; native live checks use the existing OpenAI key and Ollama service. Real Codex needs separate authentication. Hosted rehearsal requires deploying this revision and verifying access, Linux cleanup and backup restoration.
