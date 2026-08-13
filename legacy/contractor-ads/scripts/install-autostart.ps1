# ============================================================
#  PTTR — auto-start the server when Patrick signs in to Tac HQ.
#  Registers a Scheduled Task that runs START-PTTR-ADS.bat at logon.
#  Run as Administrator:
#    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#  Remove later with:
#    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
# ============================================================
param([switch]$Uninstall)

$taskName = "PTTR-Marketing-Ads"
$projectDir = Split-Path -Parent $PSScriptRoot   # repo root (parent of scripts\)
$bat = Join-Path $projectDir "START-PTTR-ADS.bat"

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$taskName'." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $bat)) {
    Write-Host "ERROR: $bat not found — run this script from inside the project folder." -ForegroundColor Red
    exit 1
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Starts the PTTR Marketing & Ads server (uvicorn, port 8000) at sign-in." -Force | Out-Null

Write-Host "Scheduled task '$taskName' installed — server starts automatically when $env:USERNAME signs in." -ForegroundColor Green
Write-Host "Start it right now with:  Start-ScheduledTask -TaskName $taskName"
