"""Compile Moloch slides, readable speaker notes, and an image-based PPTX export."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import quote

import fitz


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]

def tex(value):
    """Escape prose without interpreting it as LaTeX commands."""
    replacements = {
        "\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
        "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
        "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(char, char) for char in value).replace("--", "-{}-")


def references_tex(note):
    """Create links relative to the PDFs' final output directory."""
    return r"\par ".join(
        r"\href{run:../../../" + quote(ref, safe="/#-_").replace("#", r"\#").replace("%", r"\%")
        + "}{" + tex(
            ("Wiki: " if ref.startswith("llm-wiki/") else "Source: ")
            + (ref.split("#", 1)[1].replace("-", " ") if "#" in ref else ref.replace("/", " / ").replace("-", " "))
        ) + "}"
        for ref in note["references"]
    )


def make_notes(notes, build):
    """Generate Beamer note macros and a readable Markdown companion from one source."""
    macros = []
    markdown = [
        "# Slide-by-slide speaker notes", "",
        f"12 main slides, {sum(note['seconds'] for note in notes) // 60} minutes {sum(note['seconds'] for note in notes) % 60} seconds of planned cues; four optional backup slides.", "",
        "GCP is not deployed. All hosted demonstrations below are plans for after deployment.", "",
        "The notes in the PowerPoint export come from the same `notes.json` source.", "",
    ]
    for number, note in enumerate(notes, 1):
        for ref in note["references"]:
            if not (REPO / ref.split("#", 1)[0]).is_file():
                raise ValueError(f"Missing reference: {ref}")
        blocks = [r"\textbf{Speaking points}\par"]
        blocks.extend(tex(point) + r"\par\smallskip" for point in note["talking_points"])
        for key, label in (("demo", "Suggested demonstration"), ("fallback", "Fallback"), ("limit", "Boundary to state")):
            blocks.append(r"\textbf{" + label + "}: " + tex(note[key]) + r"\par\smallskip")
        blocks.append(r"\textbf{References}: " + references_tex(note))
        macros.append(r"\expandafter\def\csname SlideNote" + str(number) + r"\endcsname{" + "\n".join(blocks) + "}")
        timing = f'{note["seconds"]} seconds' if note["seconds"] else "Backup; use only for questions"
        markdown.extend([f'## {number:02d}. {note["title"]}', "", f"**Target time:** {timing}.", "", "**Speaking points**", ""])
        markdown.extend(f"- {point}" for point in note["talking_points"])
        for key, label in (("demo", "Suggested demonstration"), ("fallback", "Fallback"), ("limit", "Boundary to state")):
            markdown.extend(["", f"**{label}:** {note[key]}"])
        markdown.extend(["", "**References:** " + "; ".join(f"[{ref}](../../{ref})" for ref in note["references"]), ""])
    macros.append(r"\newcommand{\DeckNote}[1]{\note{\csname SlideNote#1\endcsname}}")
    (build / "notes.generated.tex").write_text("\n".join(macros), encoding="utf-8")
    (ROOT / "speaker-notes.md").write_text("\n".join(markdown), encoding="utf-8")


def compile_tex(engine, source, build):
    """Compile and reject LaTeX content overflow before exporting."""
    result = subprocess.run(
        [str(engine), "-X", "compile", "--untrusted", "--keep-logs", "--outdir", str(build), str(source)],
        cwd=build, text=True, encoding="utf-8", errors="replace", capture_output=True,
    )
    (build / f"{source.stem}.compiler.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"LaTeX failed; see {build / (source.stem + '.compiler.txt')}")
    log = (build / f"{source.stem}.log").read_text(encoding="utf-8", errors="replace")
    overflow = re.findall(r"Overfull [^\n]+", log)
    if overflow:
        raise RuntimeError("LaTeX overflow: " + "; ".join(overflow))


def export_pptx(notes_path, build, target):
    """Use native PowerPoint to package compiled images and editable speaker notes."""
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-File", str(ROOT / "export-powerpoint.ps1"),
         "-BuildDirectory", str(build), "-NotesPath", str(notes_path), "-OutputPath", str(target)],
        check=True,
    )


def main():
    """Build a reproducible deck without changing the cloned theme or runtime project."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--moloch-source", type=Path, required=True)
    parser.add_argument("--tectonic", type=Path, required=True)
    args = parser.parse_args()
    engine = args.tectonic.resolve()
    theme = args.moloch_source.resolve()
    build = ROOT / ".build"
    output = ROOT / "output"
    build.mkdir(exist_ok=True)
    output.mkdir(exist_ok=True)
    notes = json.loads((ROOT / "notes.json").read_text(encoding="utf-8"))
    source = (ROOT / "slides.tex").read_text(encoding="utf-8")
    if source.count(r"\begin{frame}") != len(notes):
        raise ValueError("Every slide must have one matching notes entry")
    for path in (theme / "src").glob("*.dtx"):
        shutil.copy2(path, build / path.name)
    shutil.copy2(theme / "src" / "beamerthememoloch.ins", build)
    subprocess.run([str(engine), "-X", "compile", "--untrusted", "--outfmt", "fmt", "beamerthememoloch.ins"], cwd=build, check=True, capture_output=True)
    shutil.copy2(ROOT / "slides.tex", build)
    shutil.copytree(ROOT / "assets", build / "assets", dirs_exist_ok=True)
    make_notes(notes, build)
    compile_tex(engine, build / "slides.tex", build)

    document = fitz.open(build / "slides.pdf")
    if len(document) != len(notes):
        raise ValueError("Unexpected PDF page count; avoid overlays without matching notes")
    for number, page in enumerate(document, 1):
        path = build / f"slide-{number:02d}.png"
        page.get_pixmap(matrix=fitz.Matrix(3.5, 3.5), alpha=False).save(path)
    article = [r"\documentclass[10pt]{article}", r"\usepackage[margin=16mm,a4paper]{geometry}", r"\usepackage{graphicx}", r"\usepackage[hidelinks]{hyperref}", r"\usepackage{lmodern}", r"\setlength{\parindent}{0pt}", r"\setlength{\parskip}{4pt}", r"\begin{document}", r"\raggedright"]
    for number, note in enumerate(notes, 1):
        if number > 1:
            article.append(r"\clearpage")
        article.extend([r"\section*{" + f'{number:02d}. ' + tex(note["title"]) + "}", r"\begin{center}\includegraphics[page=" + str(number) + r",width=.60\linewidth]{slides.pdf}\end{center}"])
        article.append(r"\textbf{Target time}: " + (str(note["seconds"]) + " seconds" if note["seconds"] else "Backup slide") + r"\par")
        article.extend([r"\textbf{Speaking points}", r"\begin{itemize}"])
        article.extend(r"\item " + tex(point) for point in note["talking_points"])
        article.append(r"\end{itemize}")
        for key, label in (("demo", "Suggested demonstration"), ("fallback", "Fallback"), ("limit", "Boundary to state")):
            article.append(r"\textbf{" + label + "}: " + tex(note[key]) + r"\par")
        article.append(r"{\footnotesize\textbf{References}: " + references_tex(note) + "}")
    article.append(r"\end{document}")
    (build / "speaker-notes.tex").write_text("\n".join(article), encoding="utf-8")
    compile_tex(engine, build / "speaker-notes.tex", build)
    shutil.copy2(build / "slides.pdf", output / "collaborative-pi-durable.pdf")
    shutil.copy2(build / "speaker-notes.pdf", output / "speaker-notes.pdf")
    export_pptx(ROOT / "notes.json", build, output / "collaborative-pi-durable.pptx")
    print(json.dumps({"slides": len(notes), "main_seconds": sum(note["seconds"] for note in notes), "output": str(output)}, indent=2))


if __name__ == "__main__":
    main()
