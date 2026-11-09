# Package compiled Beamer slide images and editable notes using installed PowerPoint.
param(
    [Parameter(Mandatory = $true)][string]$BuildDirectory,
    [Parameter(Mandatory = $true)][string]$NotesPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$notes = Get-Content -Raw -Encoding utf8 -LiteralPath $NotesPath | ConvertFrom-Json
$wasRunning = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$application = New-Object -ComObject PowerPoint.Application
$previousAlerts = $application.DisplayAlerts
$presentation = $null

try {
    $application.DisplayAlerts = 1
    $presentation = $application.Presentations.Add(0)
    $presentation.PageSetup.SlideWidth = 960
    $presentation.PageSetup.SlideHeight = 540

    for ($index = 0; $index -lt $notes.Count; $index++) {
        $note = $notes[$index]
        $slide = $presentation.Slides.Add($index + 1, 12)
        $imagePath = Join-Path $BuildDirectory ('slide-{0:d2}.png' -f ($index + 1))
        $picture = $slide.Shapes.AddPicture($imagePath, 0, -1, 0, 0, 960, 540)
        $picture.AlternativeText = $note.title + '. Compiled LaTeX slide; edit slides.tex to change visuals.'
        $lines = @($note.title)
        if ($note.seconds -gt 0) { $lines += "Target time: $($note.seconds) seconds" }
        else { $lines += 'Backup slide; use only for questions' }
        $lines += 'Speaking points:'
        $lines += $note.talking_points
        $lines += 'Suggested demonstration: ' + $note.demo
        $lines += 'Fallback: ' + $note.fallback
        $lines += 'Boundary to state: ' + $note.limit
        $lines += 'Wiki/source references (relative to this deck):'
        $lines += @($note.references | ForEach-Object { '../../../' + $_ })

        $notesBody = $null
        foreach ($shape in $slide.NotesPage.Shapes.Placeholders) {
            if ($shape.PlaceholderFormat.Type -eq 2) { $notesBody = $shape; break }
        }
        if ($null -eq $notesBody) { throw "No notes body on slide $($index + 1)" }
        $notesBody.TextFrame.TextRange.Text = $lines -join "`r"
    }

    $presentation.SaveAs($OutputPath, 24)
    [pscustomobject]@{slides = $presentation.Slides.Count; output = $OutputPath} | ConvertTo-Json
} finally {
    if ($null -ne $presentation) { $presentation.Close() }
    $application.DisplayAlerts = $previousAlerts
    if (-not $wasRunning -and $application.Presentations.Count -eq 0) { $application.Quit() }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($application)
}
