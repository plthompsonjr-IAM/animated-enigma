from dotenv import load_dotenv

load_dotenv()  # must run before routes import so ANTHROPIC_API_KEY is available

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import STATIC_DIR, ensure_dirs
from .database import engine
from . import models
from .routes import ads as ads_router

ensure_dirs()
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="ContractorAds", description="Interactive Ad Generator for General Contractors")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.include_router(ads_router.router)
