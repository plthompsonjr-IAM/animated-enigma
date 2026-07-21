# ContractorAds — Everything an Agent Needs to Build This App

This document is the complete brief for an AI agent (or new developer) to build, run,
and extend **ContractorAds**: an interactive ad generator for general contractors.
It covers the product spec, tech stack, environment setup, architecture, data model,
routes, AI integration, conventions, and the known gaps to work on next.

---

## 1. Product Overview

**What it is:** A small full-stack web app where a contractor enters their business
details (and optionally uploads a photo of their work), and Claude generates
platform-specific ad copy (headline, body, call-to-action) they can edit and save.

**Who it's for:** Local service contractors — roofing, plumbing, electrical, HVAC,
remodeling, etc. — who need quick, professional ad copy for Facebook, Google,
Instagram, Nextdoor, or Craigslist.

**Core user flow:**
1. User opens the home page and sees a list of all saved ads.
2. User clicks **+ New Ad** and fills in business name, contractor type, services,
   location, and optional phone/website/tagline/photo/platform.
3. The ad is saved as a `draft` and the user lands on its detail page.
4. User clicks **Generate** — the app calls the Claude API (with the work photo
   attached, if uploaded) and fills in `ad_headline`, `ad_body`, and `ad_cta`.
5. User can edit any field, regenerate, replace the photo, and set status
   (e.g. `draft` → `published`).

---

## 2. Tech Stack

| Layer      | Choice                                        |
|------------|-----------------------------------------------|
| Backend    | Python 3.10+, FastAPI                         |
| Server     | Uvicorn (reload mode in development)          |
| Database   | SQLite via SQLAlchemy 2.x ORM (`ads.db`)      |
| Templates  | Jinja2 (server-rendered HTML)                 |
| Styling    | Tailwind CSS via CDN (no build step)          |
| AI         | Anthropic Python SDK — model `claude-haiku-4-5-20251001` |
| Uploads    | `python-multipart`, files stored on disk in `static/uploads/` |
| Config     | `python-dotenv` (`.env` file)                 |

There is **no** JavaScript framework, no bundler, and no frontend build step.
All pages are server-rendered forms with standard POST/redirect flows.

---

## 3. Prerequisites & Environment Setup

**Required:**
- Python 3.10 or newer
- An Anthropic API key with access to the Claude API

**Setup steps:**

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Configure the API key (never commit this)
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env

# Run the dev server
python run.py                    # serves http://localhost:8000 with auto-reload
```

Notes:
- `run.py` calls `load_dotenv()` before starting Uvicorn, so `.env` is honored.
- The SQLite database `ads.db` is created automatically on first startup via
  `models.Base.metadata.create_all(bind=engine)` in `app/main.py`.
- `.gitignore` already excludes `.env`, `*.db`, `static/uploads/*` (except
  `.gitkeep`), virtualenvs, and Python bytecode. Keep it that way.

**Environment variables:**

| Variable            | Required | Purpose                                   |
|---------------------|----------|-------------------------------------------|
| `ANTHROPIC_API_KEY` | Yes (for generation) | Auth for the Claude API call. The app runs without it, but `POST /ads/{id}/generate` returns HTTP 500 until it's set. |

---

## 4. Project Structure

```
animated-enigma/
├── run.py                  # Entry point: loads .env, runs uvicorn app.main:app :8000
├── requirements.txt        # fastapi, uvicorn, jinja2, sqlalchemy, python-multipart, anthropic
├── .gitignore
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI app, static mount, router include, table creation
│   ├── database.py         # Engine (sqlite:///./ads.db), SessionLocal, Base, get_db dependency
│   ├── models.py           # Ad model (single table: "ads")
│   ├── routes/
│   │   ├── __init__.py
│   │   └── ads.py          # All routes: CRUD + image upload + Claude generation
│   └── templates/
│       ├── base.html       # Layout: nav, Tailwind CDN config (brand orange #f97316)
│       ├── index.html      # Ad list (home page)
│       ├── create.html     # New-ad form
│       ├── edit.html       # Edit form (includes generated-copy fields + status)
│       └── view.html       # Ad detail / preview page with Generate button
└── static/
    └── uploads/            # Uploaded work photos (gitignored, .gitkeep tracked)
```

**Important path convention:** the app must be launched from the repository root.
Both the templates directory (`app/templates`) and the upload directory
(`static/uploads`) are referenced by *relative* paths.

---

## 5. Data Model

Single table `ads` (`app/models.py`):

| Column           | Type          | Notes                                    |
|------------------|---------------|------------------------------------------|
| `id`             | Integer PK    | Auto-increment, indexed                  |
| `business_name`  | String(200)   | Required                                 |
| `contractor_type`| String(100)   | Required — one of `CONTRACTOR_TYPES`     |
| `services`       | Text          | Required — free-text list of services    |
| `location`       | String(200)   | Required — city/area served              |
| `phone`          | String(50)    | Optional                                 |
| `website`        | String(200)   | Optional                                 |
| `tagline`        | String(500)   | Optional — fed into the AI prompt        |
| `ad_headline`    | String(300)   | AI-generated (editable)                  |
| `ad_body`        | Text          | AI-generated (editable)                  |
| `ad_cta`         | String(200)   | AI-generated (editable)                  |
| `image_path`     | String(500)   | Relative path like `static/uploads/<uuid>.<ext>` |
| `platform`       | String(50)    | Lowercased; default `facebook`           |
| `status`         | String(20)    | Default `draft`                          |
| `created_at`     | DateTime(tz)  | `server_default=func.now()`              |
| `updated_at`     | DateTime(tz)  | `onupdate=func.now()`                    |

**Domain constants** (defined in `app/routes/ads.py`):
- `CONTRACTOR_TYPES`: General Contractor, Roofing, Plumbing, Electrical, HVAC,
  Flooring, Painting, Landscaping, Concrete, Remodeling, Framing, Insulation,
  Drywall, Masonry.
- `PLATFORMS`: Facebook, Google, Instagram, Nextdoor, Craigslist.
- `ALLOWED_TYPES` (uploads): `image/jpeg`, `image/png`, `image/webp`, `image/gif`.

There are **no migrations** — schema changes require deleting `ads.db` (dev only)
or adding a migration tool (see Roadmap).

---

## 6. Routes (all in `app/routes/ads.py`)

| Method | Path                   | Purpose                                          |
|--------|------------------------|--------------------------------------------------|
| GET    | `/`                    | List all ads, newest first (`index.html`)        |
| GET    | `/ads/new`             | New-ad form (`create.html`)                      |
| POST   | `/ads/new`             | Create ad from form data (+ optional image), redirect 303 to detail |
| GET    | `/ads/{id}`            | Ad detail / preview (`view.html`)                |
| GET    | `/ads/{id}/edit`       | Edit form (`edit.html`)                          |
| POST   | `/ads/{id}/edit`       | Update all fields; replacing the image deletes the old file |
| POST   | `/ads/{id}/generate`   | Call Claude, save headline/body/cta, redirect 303 back to detail |

Conventions:
- Forms POST `multipart/form-data`; handlers accept `Form(...)` / `File(None)` params.
- Successful mutations redirect with **HTTP 303** (POST-redirect-GET).
- Missing ads raise `HTTPException(404)`.
- DB access goes through the `get_db` dependency (session per request, closed in `finally`).

---

## 7. AI Integration (the core feature)

Located in `generate_ad_copy` (`app/routes/ads.py`):

1. Reads `ANTHROPIC_API_KEY` from the environment; 500s with a clear message if unset.
2. Builds a copywriter prompt containing business name, type, services, location,
   tagline, phone, and target platform.
3. If the ad has an uploaded photo, the image is base64-encoded and sent as an
   `image` content block **before** the text prompt, and the prompt instructs the
   model to use specific visual details from the photo.
4. Calls `client.messages.create` with model `claude-haiku-4-5-20251001`,
   `max_tokens=400`.
5. The model is instructed to return **only** a JSON object:
   `{"headline": ..., "body": ..., "cta": ...}`. The handler strips accidental
   markdown code fences before `json.loads`, then saves the three fields.

When modifying this feature keep the JSON-only contract, keep image blocks ahead of
text, and prefer small/fast models (Haiku-class) — generation is a synchronous
request in the page flow, so latency matters.

---

## 8. File Uploads

- `save_image()` validates `content_type` against `ALLOWED_TYPES`, generates a
  `uuid4().hex` filename preserving the original extension, and writes to
  `static/uploads/`.
- Invalid/missing files return `None` silently (the ad is simply saved without an image).
- On edit, uploading a replacement deletes the previous file from disk.
- Uploaded files are gitignored; only `static/uploads/.gitkeep` is tracked.

---

## 9. Frontend Conventions

- Every page extends `base.html`, which loads Tailwind from the CDN and defines the
  brand color (`brand` = orange `#f97316`, `brand-dark` = `#ea580c`).
- Dark nav bar with the "AD" logo mark; content constrained to `max-w-6xl`.
- Match existing utility-class styling — no custom CSS files, no JS beyond what a
  template already includes.
- Select fields are populated from `CONTRACTOR_TYPES` / `PLATFORMS` passed in the
  template context; add new options in `ads.py`, not in the templates.

---

## 10. Definition of Done for Changes

Before pushing any change, an agent should verify:

1. `python run.py` starts cleanly from the repo root and `GET /` renders.
2. The full flow works: create ad → view → generate (with `ANTHROPIC_API_KEY` set)
   → edit → save. Without the key, everything except Generate must still work.
3. Image upload round-trips: file appears in `static/uploads/`, renders on the
   view page, and is replaced (old file deleted) on edit.
4. No secrets, `ads.db`, or uploaded images are committed.
5. Commit messages are clear and descriptive; work goes on the designated feature
   branch, never directly on another branch.

---

## 11. Known Gaps / Roadmap (good next tasks)

These are the current shortcomings an agent could be asked to address:

- **No delete route** — ads (and their image files) can't be removed from the UI.
- **No tests** — add `pytest` + `httpx` `TestClient` coverage for routes, plus a
  mocked Anthropic client for the generate flow.
- **No input validation beyond "required"** — e.g. phone/website format, max
  upload size, `contractor_type`/`platform`/`status` restricted server-side to the
  known lists.
- **No error page for AI failures** — a Claude API error or malformed JSON response
  currently surfaces as a raw 500; catch it and re-render the view page with a
  friendly error message.
- **No migrations** — introduce Alembic before any schema change ships.
- **No auth / multi-user support** — everything is single-tenant and public.
- **Synchronous generation UX** — no loading indicator; consider a spinner or
  background task if generation is slow.
- **No pagination or search** on the ad list.
- **Deployment story** — currently dev-only (`reload=True`, SQLite); a production
  setup needs a proper server invocation, persistent volume for uploads/DB, and
  secret management for the API key.
