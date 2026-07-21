# ============================================================
#  PTTR — back up the database and uploaded photos.
#  Run:  powershell -ExecutionPolicy Bypass -File scripts\backup-pttr-ads.ps1
#  Creates C:\PTTR\backups\pttr-ads-YYYY-MM-DD_HHmm.zip
#  (containing ads.db + static\uploads). Keeps the 30 newest backups.
# ============================================================

$projectDir = Split-Path -Parent $PSScriptRoot
$backupRoot = "C:\PTTR\backups"
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$zip = Join-Path $backupRoot "pttr-ads-$stamp.zip"

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$items = @()
if (Test-Path (Join-Path $projectDir "ads.db")) { $items += (Join-Path $projectDir "ads.db") }
if (Test-Path (Join-Path $projectDir "static\uploads")) { $items += (Join-Path $projectDir "static\uploads") }
if (-not $items) { Write-Host "Nothing to back up yet (no ads.db, no uploads)."; exit 0 }

Compress-Archive -Path $items -DestinationPath $zip -Force
Write-Host "Backup written: $zip" -ForegroundColor Green

Get-ChildItem $backupRoot -Filter "pttr-ads-*.zip" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force
