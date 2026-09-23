$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel).Trim()
$projectRoot = Join-Path $repoRoot "bd21topup"
$outputPath = Join-Path $projectRoot "docs\COMMIT_HISTORY.md"

$logLines = @(git -C $repoRoot log --date=short --pretty=format:"%ad%x09%h%x09%s")

$rows = foreach ($line in $logLines) {
    $parts = $line -split "`t", 3
    if ($parts.Count -lt 3) { continue }
    $message = $parts[2].Replace("|", "\|")
    "| $($parts[0]) | ``$($parts[1])`` | $message |"
}

$header = @(
    "# BD21topup - Full Git Commit History",
    "",
    "This file is generated directly from the repository Git history.",
    "",
    "For the curated engineering story, see:",
    "- PROJECT_JOURNEY.md",
    "- PROBLEM_SOLVING_LOG.md",
    "- SECURITY_ENGINEERING.md",
    "",
    "## Commits",
    "",
    "| Date | Commit | Message |",
    "|---|---|---|"
)

$content = @($header + $rows)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($outputPath, $content, $utf8NoBom)

$count = (git -C $repoRoot rev-list --count HEAD).Trim()
Write-Host "Generated $outputPath from $count commits."
