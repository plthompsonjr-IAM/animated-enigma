@echo off
REM ============================================================
REM  PTTR Marketing & Ads — start server on Tac HQ
REM  Serves on all interfaces, port 8000 (LAN access allowed
REM  only via the Private-profile firewall rule).
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist ".env" if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [PTTR] Created .env from .env.example — add your ANTHROPIC_API_KEY there to enable AI generation.
)

if not exist ".venv\Scripts\python.exe" (
    echo [PTTR] Creating virtual environment...
    py -3 -m venv .venv || python -m venv .venv
    if errorlevel 1 (
        echo [PTTR] ERROR: Python not found. Install Python 3.10+ from python.org and re-run.
        pause
        exit /b 1
    )
    echo [PTTR] Installing packages...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

if not exist "static\uploads" mkdir "static\uploads"

echo [PTTR] Starting PTTR Marketing ^& Ads on http://0.0.0.0:8000 ...
echo [PTTR] Local:   http://127.0.0.1:8000
echo [PTTR] Network: http://%COMPUTERNAME%:8000  (or the Tac HQ IPv4 address)
echo [PTTR] Press Ctrl+C to stop, or run STOP-PTTR-ADS.bat
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
endlocal
