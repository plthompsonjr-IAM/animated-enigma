from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .database import engine
from . import models
from .routes import ads as ads_router

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="ContractorAds", description="Interactive Ad Generator for General Contractors")
app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(ads_router.router)
