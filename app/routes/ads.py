import os
import anthropic
from fastapi import APIRouter, Depends, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models import Ad

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

CONTRACTOR_TYPES = [
    "General Contractor", "Roofing", "Plumbing", "Electrical",
    "HVAC", "Flooring", "Painting", "Landscaping", "Concrete",
    "Remodeling", "Framing", "Insulation", "Drywall", "Masonry",
]

PLATFORMS = ["Facebook", "Google", "Instagram", "Nextdoor", "Craigslist"]


@router.get("/", response_class=HTMLResponse)
async def list_ads(request: Request, db: Session = Depends(get_db)):
    ads = db.query(Ad).order_by(Ad.created_at.desc()).all()
    return templates.TemplateResponse(request, "index.html", context={"ads": ads})


@router.get("/ads/new", response_class=HTMLResponse)
async def new_ad_form(request: Request):
    return templates.TemplateResponse(request, "create.html", context={
        "contractor_types": CONTRACTOR_TYPES,
        "platforms": PLATFORMS,
        "ad": None,
        "error": None,
    })


@router.post("/ads/new")
async def create_ad(
    request: Request,
    business_name: str = Form(...),
    contractor_type: str = Form(...),
    services: str = Form(...),
    location: str = Form(...),
    phone: Optional[str] = Form(None),
    website: Optional[str] = Form(None),
    tagline: Optional[str] = Form(None),
    platform: str = Form("facebook"),
    db: Session = Depends(get_db),
):
    ad = Ad(
        business_name=business_name,
        contractor_type=contractor_type,
        services=services,
        location=location,
        phone=phone or "",
        website=website or "",
        tagline=tagline or "",
        platform=platform.lower(),
        status="draft",
    )
    db.add(ad)
    db.commit()
    db.refresh(ad)
    return RedirectResponse(url=f"/ads/{ad.id}", status_code=303)


@router.get("/ads/{ad_id}", response_class=HTMLResponse)
async def view_ad(request: Request, ad_id: int, db: Session = Depends(get_db)):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    return templates.TemplateResponse(request, "view.html", context={"ad": ad, "platforms": PLATFORMS})


@router.get("/ads/{ad_id}/edit", response_class=HTMLResponse)
async def edit_ad_form(request: Request, ad_id: int, db: Session = Depends(get_db)):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    return templates.TemplateResponse(request, "edit.html", context={
        "ad": ad,
        "contractor_types": CONTRACTOR_TYPES,
        "platforms": PLATFORMS,
        "error": None,
    })


@router.post("/ads/{ad_id}/edit")
async def update_ad(
    request: Request,
    ad_id: int,
    business_name: str = Form(...),
    contractor_type: str = Form(...),
    services: str = Form(...),
    location: str = Form(...),
    phone: Optional[str] = Form(None),
    website: Optional[str] = Form(None),
    tagline: Optional[str] = Form(None),
    platform: str = Form("facebook"),
    ad_headline: Optional[str] = Form(None),
    ad_body: Optional[str] = Form(None),
    ad_cta: Optional[str] = Form(None),
    status: str = Form("draft"),
    db: Session = Depends(get_db),
):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")

    ad.business_name = business_name
    ad.contractor_type = contractor_type
    ad.services = services
    ad.location = location
    ad.phone = phone or ""
    ad.website = website or ""
    ad.tagline = tagline or ""
    ad.platform = platform.lower()
    ad.ad_headline = ad_headline or ad.ad_headline
    ad.ad_body = ad_body or ad.ad_body
    ad.ad_cta = ad_cta or ad.ad_cta
    ad.status = status
    db.commit()
    return RedirectResponse(url=f"/ads/{ad_id}", status_code=303)


@router.post("/ads/{ad_id}/generate")
async def generate_ad_copy(
    request: Request,
    ad_id: int,
    db: Session = Depends(get_db),
):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""You are an expert copywriter specializing in local service advertising for contractors.

Generate a compelling {ad.platform} ad for this contractor:
- Business: {ad.business_name}
- Type: {ad.contractor_type}
- Services: {ad.services}
- Location: {ad.location}
- Tagline: {ad.tagline or 'none provided'}
- Phone: {ad.phone or 'not provided'}

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{{
  "headline": "short punchy headline (max 10 words)",
  "body": "compelling ad body (2-3 sentences, include location and key services, end with urgency)",
  "cta": "call-to-action button text (max 5 words)"
}}"""

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )

    import json
    raw = message.content[0].text.strip()
    # strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw)

    ad.ad_headline = data.get("headline", "")
    ad.ad_body = data.get("body", "")
    ad.ad_cta = data.get("cta", "Get a Free Quote")
    db.commit()

    return RedirectResponse(url=f"/ads/{ad_id}", status_code=303)
