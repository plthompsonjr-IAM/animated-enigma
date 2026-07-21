# ============================================================
#  PTTR — allow TCP 8000 inbound on PRIVATE networks only.
#  Run as Administrator:
#    powershell -ExecutionPolicy Bypass -File scripts\setup-firewall.ps1
#  Port 8000 stays blocked on Public/Domain profiles and is never
#  exposed to the internet (no router port-forwarding is configured).
# ============================================================

$name = "PTTR Marketing Ads (TCP 8000, Private)"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: run this from an *Administrator* PowerShell." -ForegroundColor Red
    exit 1
}

$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Rule already exists — nothing to do." -ForegroundColor Green
    exit 0
}

New-NetFirewallRule -DisplayName $name `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 `
    -Profile Private | Out-Null

Write-Host "Created inbound rule '$name' (TCP 8000, Private profile only)." -ForegroundColor Green
