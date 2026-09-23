$ErrorActionPreference = "Stop"

$root = git rev-parse --show-toplevel
Set-Location $root

New-Item -ItemType Directory -Force "docs" | Out-Null

$lines = git log --date=short --pretty=format:"| %ad | ``%h`` | %s |"

$header = @"
# BD21topup — Full Git Commit History

This file is generated directly from the repository Git history.

For the curated engineering story, see:
- `PROJECT_JOURNEY.md`
- `PROBLEM_SOLVING_LOG.md`
- `SECURITY_ENGINEERING.md`

## Commits

| Date | Commit | Message |
|---|---|---|
"@

$content = $header + "`r`n" + ($lines -join "`r`n") + "`r`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("docs\COMMIT_HISTORY.md", $content, $utf8NoBom)

$count = (git rev-list --count HEAD).Trim()
Write-Host "Generated docs/COMMIT_HISTORY.md from $count commits."
