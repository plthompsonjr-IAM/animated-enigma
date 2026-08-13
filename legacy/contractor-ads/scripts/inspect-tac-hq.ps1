# ============================================================
#  PTTR — Tac HQ pre-flight inspection (read-only, changes nothing)
#  Run:  powershell -ExecutionPolicy Bypass -File scripts\inspect-tac-hq.ps1
# ============================================================

Write-Host "=== Windows version ===" -ForegroundColor Cyan
$os = Get-CimInstance Win32_OperatingSystem
Write-Host ("{0}  (build {1})" -f $os.Caption, $os.BuildNumber)

Write-Host "`n=== Python ===" -ForegroundColor Cyan
$py = Get-Command py, python -ErrorAction SilentlyContinue | Select-Object -First 1
if ($py) { & $py.Source --version } else { Write-Host "NOT FOUND — install Python 3.10+ from https://www.python.org (check 'Add to PATH')" -ForegroundColor Red }

Write-Host "`n=== Ethernet IPv4 address ===" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -ne '127.0.0.1' } |
    Format-Table InterfaceAlias, IPAddress, PrefixOrigin -AutoSize
Write-Host "PrefixOrigin 'Dhcp' means the IP can change — reserve it in the router (see README step 'Static IP')."

Write-Host "=== Network profile (must be Private for the firewall rule) ===" -ForegroundColor Cyan
Get-NetConnectionProfile | Format-Table Name, InterfaceAlias, NetworkCategory -AutoSize
Write-Host "If NetworkCategory is 'Public', fix it (admin PowerShell):"
Write-Host '  Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private' -ForegroundColor Yellow
