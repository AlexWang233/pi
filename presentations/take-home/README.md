# Collaborative Pi Durable presentation

A Moloch/LaTeX Beamer deck for an engineering interview: **12 main slides, approximately nine minutes including one short browser demonstration, plus four backup slides**. The implementation/evidence snapshot is November 8, 2026; the presentation was prepared November 9. GCP is **not deployed**: hosted demonstrations are plans for after deployment.

## Present or rehearse

- [PowerPoint deck](output/collaborative-pi-durable.pptx): compiled LaTeX slide images with **native editable speaker notes** for every slide. Open Presenter View to read the notes. The visual text/tables are not individual editable PowerPoint objects; edit `slides.tex` and rebuild to change them.
- [Slide PDF](output/collaborative-pi-durable.pdf): vector LaTeX text/tables plus the recorded local UI screenshot.
- [Speaker notes PDF](output/speaker-notes.pdf): slide thumbnails, talking points, demonstrations, boundaries, and wiki references.
- [Readable speaker notes](speaker-notes.md): the same notes with clickable repository links.
- [LaTeX source](slides.tex) and [authoritative notes](notes.json): edit these and rebuild. Generated Markdown, PDF, and PowerPoint notes come from the same JSON.

The timings total **8 minutes 30 seconds**, before questions and unpredictable model latency. Allow roughly 8–10 minutes; for an eight-minute slot, shorten the provider explanation and use the recorded screenshot rather than waiting for all four live pairings. Rehearse the actual timing; the target is not a recorded human rehearsal. Backup slides are outside the main timing.

## Demonstration plan

| Slides | What to show after GCP deployment | Boundary |
| --- | --- | --- |
| 2–4 | Members, two shared agent panels, attributed requests, same-agent follow-up if active | The default has two users; three-by-two is the preview relationship model. Fast completion may make a queue invisible |
| 5 | Four user/agent pairings, create/edit/read small files, manual file refresh, reconnect | The included screenshot is from the actual **local Ollama** walkthrough, not GCP |
| 6–7 | Controlled lost-update trace and managed-file example 41 in a separate SSH terminal | No current GUI pause/prepare/publish/conflict controls; the managed API is not bound to normal model tools |
| 8 | Reconnect and a separately rehearsed **idle** host restart on disposable data | Do not equate this with active-process containment or power-loss recovery |
| 9 | Configured native providers; optional Codex only after separate authentication/verification | Two native providers are not two tested external harnesses |
| 10 | Saved load report or VM terminal | There is no performance dashboard; the recorded workload simulated agent execution |
| 11 | Explain SSH forwarding, persistence and deployment checks | Prepared configuration is not evidence of a running or verified service |
| 12 | Explain the proposed conflict GUI and delivery gates | Do not demonstrate a planned feature as existing functionality |

Detailed prompts, fallbacks, and claims to state are in each slide's notes. Do not run destructive failure injections, uncontrolled same-file races, or stress load against the presentation's active store. Use isolated fixtures and stop prior writers before taking ownership. The deferred Windows Bash issue remains disclosed.

## Future GCP access

Follow the [deployment runbook](../../apps/collab-demo/deploy/README.md), including the model/runtime installation and Linux acceptance checks. The prepared design forwards a private VM listener to the presenter machine:

```bash
gcloud compute ssh VM_NAME --project=PROJECT_ID --zone=ZONE -- -N -L 4310:127.0.0.1:4310
```

Then open `http://127.0.0.1:4310` in two browser profiles and authenticate privately as Alice and Bob. That URL reaches GCP **through the tunnel**; no public app URL is assumed. Keep tokens, `.env`, provider keys and cloud credentials off screen. Never start a second owner against service-owned data.

On the built VM, the implemented managed-file example is independent of the web server and model keys:

```bash
cd /opt/pi/packages/durable
node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
```

It uses its own temporary files. It does not invoke the ordinary browser agents or demonstrate an existing conflict-resolution GUI.

## Rebuild

Requirements: Python 3.10+, **PyMuPDF 1.26.7**, **Tectonic 0.17.0** or a compatible Tectonic version, and the Moloch source clone. The full builder also requires **Windows PowerShell and installed Microsoft PowerPoint** for the PPTX wrapper. The first compilation can download standard LaTeX packages. Application dependencies, model keys, the demo server, and GCP are not needed to build this presentation.

The prepared tools are under the ignored repository `.artifacts/` folder. From the repo root, these are the exact commands used locally; choose another Python 3.10+ executable if the separate existing environment is unavailable:

```powershell
$PresentationPython = 'E:\Github\NimbleHackathon\.venv312\Scripts\python.exe'
$env:PYTHONPATH = 'E:\Github\pi\.artifacts\tools\presentation-python'
$env:TECTONIC_CACHE_DIR = 'E:\Github\pi\.artifacts\tools\tectonic-cache'
& $PresentationPython presentations/take-home/build.py `
  --moloch-source E:/Github/moloch `
  --tectonic E:/Github/pi/.artifacts/tools/tectonic-0.17.0/tectonic.exe
```

For another Windows machine with PowerPoint, install the pinned renderer in a dedicated environment with `python -m pip install PyMuPDF==1.26.7`, download Tectonic from its official project, and pass that compiler and your Moloch clone paths. Python uses only its standard library plus PyMuPDF; a small PowerShell script calls the installed PowerPoint application to create the wrapper and notes. It does not use `python-pptx`, change root npm dependencies, or modify the cloned template. On another OS, the LaTeX/PDF sources remain usable, but this PowerPoint packaging step needs a Windows host.

The builder extracts the local theme into ignored `.build/`, compiles the slides and notes, checks for LaTeX overflow, and exports 16:9 slide images into the PPTX with per-slide notes. PowerPoint packaging happens without opening a presentation window, closes only the presentation it created, and preserves any existing open presentations. It regenerates all output files and `speaker-notes.md`; avoid editing those generated files. The PPTX intentionally preserves the LaTeX appearance rather than promising native editable tables/charts.

## References and provenance

- [Main wiki](../../llm-wiki/README.md), [terminology guide](../../llm-wiki/09-technical-terms.md), and [question bank](../../llm-wiki/interview-questions/README.md).
- [Original presentation runbook](../../TAKE_HOME_PRESENTATION.md) and [implementation/evidence record](../../TAKE_HOME_PROGRESS.md).
- Moloch clone: `E:\Github\moloch`, revision `8dc40b8bfcd9c8a2c8c4a3d4204daa80883d0527`, theme 2.3.1. [Upstream project](https://github.com/jolars/moloch). Theme authors include Johan Larsson and the Metropolis contributors; theme source is CC-BY-SA 4.0. Theme extraction is private and unmodified; this does not impose that license on the presentation content, per the upstream README.
- Beamer skill: `E:\Github\beamer-skill`, revision `f98a66bb1d3c5d93fa21a07c5151afedf2b1d535`. [Upstream skill](https://github.com/wenlzhang/beamer-skill), MIT; used as authoring guidance.
- Compiler: [official Tectonic 0.17.0 release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0); the Windows MSVC archive was verified against release SHA-256 `f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f`.
- UI asset: `assets/local-ollama-browser.png`, copied from the previously recorded local browser screenshot in `.artifacts/ollama-browser-desktop.png`. [Portable run record](../../apps/collab-demo/scripts/results/2026-11-08-ollama-browser.json). It contains no displayed login token or API key; it depicts local inference and is labelled accordingly.

## Immediate next implementation

The proposed step-controlled conflict GUI remains the next presentation feature, with no additional API key or GCP needed. Real Codex turn/continuation requires its own authentication; hosted demonstration requires GCP project/billing/IAM and verified Linux deployment, model access, cleanup and restore. This deck does not provision resources or complete those gates.
