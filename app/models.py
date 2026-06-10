from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from .database import Base


class Ad(Base):
    __tablename__ = "ads"

    id = Column(Integer, primary_key=True, index=True)
    business_name = Column(String(200), nullable=False)
    contractor_type = Column(String(100), nullable=False)
    services = Column(Text, nullable=False)
    location = Column(String(200), nullable=False)
    phone = Column(String(50))
    website = Column(String(200))
    tagline = Column(String(500))
    ad_headline = Column(String(300))
    ad_body = Column(Text)
    ad_cta = Column(String(200))
    image_path = Column(String(500))
    platform = Column(String(50), default="facebook")
    status = Column(String(20), default="draft")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
