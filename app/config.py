"""Central path configuration.

Every filesystem location is derived from the project root (the directory
containing this package), so the app works no matter which directory it is
launched from — e.g. C:\\PTTR\\marketing-ads on Tac HQ.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

TEMPLATES_DIR = BASE_DIR / "app" / "templates"
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = STATIC_DIR / "uploads"
DB_PATH = BASE_DIR / "ads.db"

# The DB stores image paths as URL-style relative paths ("static/uploads/x.jpg")
# so templates can render them directly; resolve them here for file access.
def resolve_media(relative_path: str) -> Path:
    return BASE_DIR / relative_path.replace("\\", "/")


def ensure_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
