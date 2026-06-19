# backend/main.py
import os
import random
import string
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, HttpUrl
from database import engine, get_db, Base
import models

Base.metadata.create_all(bind=engine)

app = FastAPI(title="DevLinks API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # We'll lock this down later in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic schemas (request/response shapes) ---
class LinkCreate(BaseModel):
    original_url: str

class LinkResponse(BaseModel):
    short_code: str
    original_url: str
    click_count: int
    short_url: str

    class Config:
        from_attributes = True

# --- Utility ---
def generate_short_code(length=6):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

# --- Routes ---
@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "devlinks-backend"}

@app.post("/api/shorten", response_model=LinkResponse)
def shorten_url(link: LinkCreate, db: Session = Depends(get_db)):
    short_code = generate_short_code()
    # Ensure uniqueness
    while db.query(models.Link).filter(models.Link.short_code == short_code).first():
        short_code = generate_short_code()

    db_link = models.Link(original_url=link.original_url, short_code=short_code)
    db.add(db_link)
    db.commit()
    db.refresh(db_link)

    base_url = os.getenv("BASE_URL", "http://localhost:8000")
    return LinkResponse(
        short_code=db_link.short_code,
        original_url=db_link.original_url,
        click_count=db_link.click_count,
        short_url=f"{base_url}/{short_code}"
    )

@app.get("/{short_code}")
def redirect_url(short_code: str, db: Session = Depends(get_db)):
    link = db.query(models.Link).filter(models.Link.short_code == short_code).first()
    if not link:
        raise HTTPException(status_code=404, detail="Short link not found")
    
    link.click_count += 1
    db.commit()

    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=link.original_url)

@app.get("/api/links", response_model=list[LinkResponse])
def list_links(db: Session = Depends(get_db)):
    links = db.query(models.Link).order_by(models.Link.created_at.desc()).limit(50).all()
    base_url = os.getenv("BASE_URL", "http://localhost:8000")
    return [
        LinkResponse(
            short_code=l.short_code,
            original_url=l.original_url,
            click_count=l.click_count,
            short_url=f"{base_url}/{l.short_code}"
        ) for l in links
    ]