# PTTR Marketing & Ads

FastAPI application for creating contractor advertisements: ad records, work-photo
uploads, and AI-generated ad copy (Anthropic API). Originally developed in a-Shell on
Patrick's iPhone; this repo is the deployable version for **Tac HQ**
(Dell OptiPlex 7090, Windows) serving the private network.

**Devices:** Tac HQ (server) · TaC-HuB (workstation) · HP computer (workstation/backup) · iPhone (field interface)

---

## Folder layout on Tac HQ

```
C:\PTTR\
├── marketing-ads\              <- this repository
│   ├── app\
│   │   ├── main.py             FastAPI app (loads .env, mounts /static)
│   │   ├── config.py           all paths, absolute, derived from project root
│   │   ├── database.py         SQLite via SQLAlchemy
│   │   ├── models.py           Ad model
│   │   ├── routes\ads.py       CRUD + photo upload + Generate (Anthropic)
│   │   └── templates\          Jinja2 templates
│   ├── static\uploads\         uploaded photos (auto-created, git-ignored)
│   ├── ads.db                  SQLite database (auto-created, git-ignored)
│   ├── .env                    ANTHROPIC_API_KEY (copy from .env.example)
│   ├── requirements.txt
│   ├── START-PTTR-ADS.bat      start server (creates venv on first run)
│   ├── STOP-PTTR-ADS.bat       stop server
│   └── scripts\                PowerShell helpers (see below)
└── backups\                    zip backups of ads.db + uploads
```

---

## 1. Pre-flight inspection

From the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\inspect-tac-hq.ps1
```

This prints the Windows version, Python version, Ethernet IPv4 address, and the
network profile. **Requirements:** Python 3.10+ installed ("Add to PATH" checked),
and the network profile must be **Private**. If it shows Public, fix it in an
admin PowerShell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
```

## 2. Get the code onto Tac HQ

```powershell
mkdir C:\PTTR
cd C:\PTTR
git clone https://github.com/plthompsonjr-IAM/animated-enigma.git marketing-ads
cd marketing-ads
```

### Transfer the iPhone data (database + photos)

The **code** is already in git, but `ads.db` and `static\uploads\` are git-ignored,
so they must be moved once. Easiest path (uses the same git remote a-Shell already
pushes to — the repo is private, and the branch is deleted afterward):

**On the iPhone (a-Shell, in the project folder):**
```bash
git checkout -b data-transfer
git add -f ads.db static/uploads
git commit -m "One-time data transfer to Tac HQ"
git push -u origin data-transfer
```

**On Tac HQ (in C:\PTTR\marketing-ads):**
```powershell
git fetch origin data-transfer
git checkout origin/data-transfer -- ads.db static/uploads
git push origin --delete data-transfer   # clean up after confirming the data arrived
```

(Alternative: zip `ads.db` + `static/uploads` on the iPhone, move the zip via
iCloud Drive / OneDrive / email, and extract into `C:\PTTR\marketing-ads`.)

## 3. Configure the API key

```powershell
copy .env.example .env
notepad .env      # paste the ANTHROPIC_API_KEY value
```

Without a key the app runs fine, but the **Generate** button returns
"ANTHROPIC_API_KEY not configured".

## 4. Start the server

Double-click **`START-PTTR-ADS.bat`** (or run it in a terminal). On first run it
creates `.venv\` and installs `requirements.txt` automatically; after that it goes
straight to:

```
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Stop it with **`STOP-PTTR-ADS.bat`** (kills whatever is listening on port 8000)
or Ctrl+C in the server window.

## 5. Open the firewall (Private networks only)

Admin PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-firewall.ps1
```

Adds one inbound rule: TCP 8000, **Private profile only**. Nothing is exposed to
the internet — do **not** create a router port-forward for 8000.

## 6. Test

| Test | How |
|---|---|
| Local | On Tac HQ open `http://127.0.0.1:8000` |
| Ad creation | New Ad → fill form → Save → appears in list |
| Photo upload | Attach a photo on create/edit → photo displays on the ad page |
| Generate button | Click Generate on an ad (needs `.env` key) → headline/body/CTA fill in |
| Multi-device | From TaC-HuB, the HP, and the iPhone (on Wi-Fi) open `http://<TAC-HQ-IP>:8000` |
| DB persistence | Stop server, start again → ads and photos still there |
| Restart recovery | Reboot Tac HQ, sign in → server auto-starts (step 7) |

`<TAC-HQ-IP>` is the Ethernet IPv4 address from step 1.

## 7. Auto-start at sign-in

Admin PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```

Registers scheduled task **PTTR-Marketing-Ads** that runs `START-PTTR-ADS.bat`
whenever Patrick signs in (auto-restarts up to 3× if it crashes). Remove with the
same script plus `-Uninstall`.

## 8. Keep the address stable (static / reserved IP)

Recommended: a **DHCP reservation** in the router — find the router's DHCP settings,
reserve Tac HQ's MAC address (shown by `getmac /v` or `ipconfig /all`) to its current
IPv4 address. Then `http://<TAC-HQ-IP>:8000` never changes. (A static IP set on the
adapter itself also works, but the router reservation is safer against conflicts.)
`http://TAC-HQ:8000` by computer name usually works from the Windows workstations too.

## 9. Backups

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup-pttr-ads.ps1
```

Zips `ads.db` + `static\uploads` to **`C:\PTTR\backups\`**, keeping the 30 newest.
To run it nightly, add a scheduled task, e.g. daily at 21:00:

```powershell
schtasks /Create /TN PTTR-Ads-Backup /SC DAILY /ST 21:00 /TR "powershell -ExecutionPolicy Bypass -File C:\PTTR\marketing-ads\scripts\backup-pttr-ads.ps1"
```

## Security notes

- The firewall rule is Private-profile only; port 8000 is never reachable from the
  internet unless a router port-forward is added — don't add one.
- `.env` (API key), `ads.db`, and uploaded photos are git-ignored and stay on Tac HQ.
- Keep the original iPhone project untouched until every test in step 6 has passed.
