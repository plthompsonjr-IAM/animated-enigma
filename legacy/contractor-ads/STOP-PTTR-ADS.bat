@echo off
REM ============================================================
REM  PTTR Marketing & Ads — stop server on Tac HQ
REM  Finds whatever process is listening on TCP 8000 and ends it.
REM ============================================================
echo [PTTR] Stopping any process listening on port 8000...
powershell -NoProfile -Command ^
  "$c = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('[PTTR] Stopped process ' + $_) } } else { Write-Host '[PTTR] Nothing is listening on port 8000.' }"
pause
