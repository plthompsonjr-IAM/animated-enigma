import os
import uuid
import base64
import json
import random
import logging
import anthropic
from fastapi import APIRouter, Depends, Request, Form, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from typing import Optional

from ..config import TEMPLATES_DIR, UPLOAD_DIR, resolve_media
from ..database import get_db
from ..models import Ad

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

CONTRACTOR_TYPES = [
    "General Contractor", "Roofing", "Plumbing", "Electrical",
    "HVAC", "Flooring", "Painting", "Landscaping", "Concrete",
    "Remodeling", "Framing", "Insulation", "Drywall", "Masonry",
]

PLATFORMS = ["Facebook", "Google", "Instagram", "Nextdoor", "Craigslist"]

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

logger = logging.getLogger("uvicorn.error")

# --- Built-in copy writer -----------------------------------------------
# Used whenever ANTHROPIC_API_KEY is missing or the API call fails, so the
# Generate button always produces usable copy.

FALLBACK_HEADLINES = [
    "{location}'s Trusted {contractor_type} Pros",
    "Top-Rated {contractor_type} in {location}",
    "{contractor_type} Done Right — {location}",
    "Quality {contractor_type} You Can Count On",
]

FALLBACK_BODIES = [
    "{business_name} delivers {services_short} across {location} — on time, on budget, done right the first time. {tagline_part}Our schedule fills up fast, so call today for your free estimate.",
    "Looking for dependable {contractor_type_lower} work in {location}? {business_name} handles {services_short} with licensed pros and honest pricing. {tagline_part}Book now — this month's slots are almost gone.",
    "{business_name} is {location}'s go-to team for {services_short}. {tagline_part}Free quotes, quality workmanship, no surprises. Reach out today before the season rush.",
]

FALLBACK_CTAS = ["Get a Free Quote", "Call Today", "Book a Free Estimate", "Get Started Now"]


def generate_fallback_copy(ad: Ad) -> dict:
    services = [s.strip() for s in ad.services.replace("\n", ",").split(",") if s.strip()]
    fields = {
        "business_name": ad.business_name,
        "contractor_type": ad.contractor_type,
        "contractor_type_lower": ad.contractor_type.lower(),
        "location": ad.location,
        "services_short": ", ".join(services[:3]) if services else ad.contractor_type.lower(),
        "tagline_part": f'"{ad.tagline}" — ' if ad.tagline else "",
    }
    return {
        "headline": random.choice(FALLBACK_HEADLINES).format(**fields),
        "body": random.choice(FALLBACK_BODIES).format(**fields),
        "cta": random.choice(FALLBACK_CTAS),
    }


async def save_image(file: UploadFile) -> Optional[str]:
    if not file or not file.filename:
        return None
    if file.content_type not in ALLOWED_TYPES:
        return None
    ext = file.filename.rsplit(".", 1)[-1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    with open(UPLOAD_DIR / filename, "wb") as f:
        f.write(content)
    # stored with forward slashes so templates can use it directly as a URL
    return f"static/uploads/{filename}"


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
    image: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    image_path = await save_image(image)
    ad = Ad(
        business_name=business_name,
        contractor_type=contractor_type,
        services=services,
        location=location,
        phone=phone or "",
        website=website or "",
        tagline=tagline or "",
        platform=platform.lower(),
        image_path=image_path,
        status="draft",
    )
    db.add(ad)
    db.commit()
    db.refresh(ad)
    return RedirectResponse(url=f"/ads/{ad.id}", status_code=303)


@router.get("/ads/{ad_id}", response_class=HTMLResponse)
async def view_ad(request: Request, ad_id: int, notice: Optional[str] = None, db: Session = Depends(get_db)):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    return templates.TemplateResponse(request, "view.html", context={"ad": ad, "platforms": PLATFORMS, "notice": notice})


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
    image: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")

    new_image_path = await save_image(image)
    if new_image_path:
        # remove old image file if present
        if ad.image_path:
            old_file = resolve_media(ad.image_path)
            if old_file.exists():
                old_file.unlink()
        ad.image_path = new_image_path

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


def generate_ai_copy(ad: Ad, api_key: str) -> dict:
    client = anthropic.Anthropic(api_key=api_key)

    text_prompt = f"""You are an expert copywriter specializing in local service advertising for contractors.

Generate a compelling {ad.platform} ad for this contractor:
- Business: {ad.business_name}
- Type: {ad.contractor_type}
- Services: {ad.services}
- Location: {ad.location}
- Tagline: {ad.tagline or 'none provided'}
- Phone: {ad.phone or 'not provided'}
{f"- A photo of their actual work is attached — use specific visual details from it to make the ad more authentic and compelling." if ad.image_path else ""}

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{{
  "headline": "short punchy headline (max 10 words)",
  "body": "compelling ad body (2-3 sentences, include location and key services, end with urgency)",
  "cta": "call-to-action button text (max 5 words)"
}}"""

    # build message content — include image if uploaded
    content = []
    image_file = resolve_media(ad.image_path) if ad.image_path else None
    if image_file and image_file.exists():
        with open(image_file, "rb") as f:
            img_data = base64.standard_b64encode(f.read()).decode("utf-8")
        ext = image_file.suffix.lstrip(".").lower()
        media_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": img_data},
        })
    content.append({"type": "text", "text": text_prompt})

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{"role": "user", "content": content}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


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
    if api_key:
        try:
            data = generate_ai_copy(ad, api_key)
            notice = "ai"
        except Exception:
            logger.exception("Claude AI generation failed; using built-in copy writer")
            data = generate_fallback_copy(ad)
            notice = "ai_failed"
    else:
        data = generate_fallback_copy(ad)
        notice = "builtin"

    ad.ad_headline = data.get("headline", "")
    ad.ad_body = data.get("body", "")
    ad.ad_cta = data.get("cta", "Get a Free Quote")
    db.commit()

    return RedirectResponse(url=f"/ads/{ad_id}?notice={notice}", status_code=303)
