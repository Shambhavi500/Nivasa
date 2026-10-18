"""HTTP routes. Everything lives under /api."""

from __future__ import annotations

import secrets
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import constants as C
from app.config import Settings, get_settings
from app.db import get_db
from app.models import College, DataSnapshot, Listing, ListingReport, MetroLine, MetroStation, Poi, RoomOption
from app.schemas import (
    CUISINES,
    CollegeOut,
    GeocodeResult,
    LineOut,
    LineStopOut,
    ListingOut,
    MatchResult,
    MetaOut,
    PoiOut,
    Preferences,
    ReportIn,
    SearchResponse,
    StationOut,
    SubmissionIn,
    TransitOut,
    Weights,
)
from app.services.context import Context, get_context
from app.services.geo import REGION_BOUNDS, Point
from app.services.geocoding import GeocoderUnavailable, get_geocoder
from app.services.matching import evaluate
from app.services.search import resolve_destination, run_search

router = APIRouter(prefix="/api")
DB = Annotated[Session, Depends(get_db)]
Cfg = Annotated[Settings, Depends(get_settings)]
Ctx = Annotated[Context, Depends(get_context)]


@router.get("/health")
def health(db: DB) -> dict:
    return {"status": "ok", "listings": db.scalar(select(func.count()).select_from(Listing)) or 0}


@router.get("/meta", response_model=MetaOut)
def meta(db: DB, settings: Cfg) -> MetaOut:
    datasets = [{"key": d.key, "source": d.source, "fetched_at": d.fetched_at, "records": d.record_count}
                for d in db.scalars(select(DataSnapshot).order_by(DataSnapshot.key))]
    return MetaOut(stay_types=C.STAY_TYPES, genders=C.GENDERS, sharing=C.SHARING, modes=C.MODES, diets=C.DIETS,
                   cuisines=list(CUISINES), amenities=C.AMENITIES, safety=C.SAFETY, essentials=C.ESSENTIALS,
                   factors=C.FACTORS, default_weights=Weights(), region_bounds=REGION_BOUNDS, datasets=datasets,
                   geocoder_enabled=settings.geocoder != "none", routing_provider=settings.routing_provider)


@router.get("/colleges", response_model=list[CollegeOut])
def colleges(db: DB) -> list[College]:
    return list(db.scalars(select(College).order_by(College.name)))


@router.get("/transit", response_model=TransitOut)
def transit(db: DB) -> TransitOut:
    lines = [LineOut(id=l.id, name=l.name, colour=l.colour, stops=[LineStopOut(name=s.name, lat=s.lat, lng=s.lng) for s in l.stops])
             for l in db.scalars(select(MetroLine).order_by(MetroLine.id))]
    stations = [StationOut.model_validate(s) for s in db.scalars(select(MetroStation).order_by(MetroStation.name))]
    snap = db.get(DataSnapshot, "metro")
    return TransitOut(lines=lines, stations=stations, source=snap.source if snap else "OpenStreetMap")


@router.get("/pois", response_model=list[PoiOut])
def pois(db: DB,
         south: Annotated[float, Query(ge=-90, le=90)], west: Annotated[float, Query(ge=-180, le=180)],
         north: Annotated[float, Query(ge=-90, le=90)], east: Annotated[float, Query(ge=-180, le=180)],
         categories: Annotated[str, Query(max_length=200)] = "",
         limit: Annotated[int, Query(ge=1, le=2000)] = 800) -> list[Poi]:
    if north <= south or east <= west:
        raise HTTPException(422, "Invalid bounding box.")
    if (north - south) * (east - west) > 0.05:  # roughly 25 km x 20 km
        raise HTTPException(422, "Zoom in to load places.")
    q = select(Poi).where(Poi.lat.between(south, north), Poi.lng.between(west, east))
    cats = [c for c in categories.split(",") if c]
    if cats:
        q = q.where(Poi.category.in_(cats))
    return list(db.scalars(q.limit(limit)))


@router.get("/pois/{poi_id}", response_model=PoiOut)
def poi_detail(poi_id: Annotated[str, Path(max_length=32)], db: DB) -> Poi:
    poi = db.get(Poi, poi_id)
    if poi is None:
        raise HTTPException(404, "Place not found.")
    return poi


@router.post("/search", response_model=SearchResponse)
def search(prefs: Preferences, db: DB, ctx: Ctx) -> SearchResponse:
    return run_search(db, prefs, ctx)


def _get_listing(db: Session, listing_id: str, settings: Settings) -> Listing:
    listing = db.get(Listing, listing_id)
    if listing is None or listing.status != "active" or (listing.is_demo and not settings.include_demo_listings):
        raise HTTPException(status_code=404, detail="Listing not found.")
    return listing


@router.get("/listings/{listing_id}", response_model=ListingOut)
def get_listing(listing_id: str, db: DB, settings: Cfg) -> Listing:
    return _get_listing(db, listing_id, settings)


@router.post("/listings/{listing_id}/match", response_model=MatchResult)
def match_listing(listing_id: str, prefs: Preferences, db: DB, ctx: Ctx, settings: Cfg) -> MatchResult:
    listing = _get_listing(db, listing_id, settings)
    dest = resolve_destination(db, prefs.destination)
    return evaluate(listing, prefs, Point(dest.lat, dest.lng), dest.short_label, ctx)


@router.post("/listings/{listing_id}/reports", status_code=status.HTTP_201_CREATED)
def report_listing(listing_id: str, body: ReportIn, db: DB, settings: Cfg) -> dict:
    _get_listing(db, listing_id, settings)
    db.add(ListingReport(listing_id=listing_id, topic=body.topic, message=body.message.strip()))
    db.commit()
    return {"status": "received"}


@router.post("/submissions", status_code=status.HTTP_201_CREATED)
def submit_listing(body: SubmissionIn, db: DB) -> dict:
    listing = Listing(
        id=f"sub-{uuid4().hex[:10]}", name=body.name.strip(), stay_type=body.stay_type, gender=body.gender,
        area=body.area.strip(), address=body.address, lat=body.lat, lng=body.lng, location_precision="exact",
        description=body.notes, food_included=body.food_included, amenities=dict(body.amenities), safety={},
        contact_name=body.contact_name, contact_phone=body.contact_phone, is_demo=False, status="pending",
        verification_status="owner_submitted", data_source="Submitted through Nivasa",
        rooms=[RoomOption(sharing=r.sharing, monthly_rent=r.monthly_rent) for r in body.rooms],
    )
    db.add(listing)
    db.commit()
    return {"id": listing.id, "status": "pending",
            "message": "Thanks. The listing will appear after a review."}


def require_admin(settings: Cfg, x_admin_key: Annotated[str | None, Header()] = None) -> None:
    if not settings.admin_api_key:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access is disabled. Set NIVASA_ADMIN_API_KEY to enable it.")
    if not x_admin_key or not secrets.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin key.")


Admin = Annotated[None, Depends(require_admin)]


@router.get("/admin/submissions", response_model=list[ListingOut])
def list_submissions(db: DB, _: Admin) -> list[Listing]:
    return list(db.scalars(select(Listing).where(Listing.status == "pending").order_by(Listing.created_at)))


@router.post("/admin/submissions/{listing_id}/{decision}")
def decide_submission(listing_id: str, decision: str, db: DB, _: Admin) -> dict:
    if decision not in ("approve", "reject"):
        raise HTTPException(404, "Unknown action.")
    listing = db.get(Listing, listing_id)
    if listing is None or listing.status != "pending":
        raise HTTPException(404, "No pending submission with that id.")
    listing.status = "active" if decision == "approve" else "rejected"
    db.commit()
    return {"id": listing_id, "status": listing.status}


@router.get("/geocode", response_model=list[GeocodeResult])
def geocode(q: Annotated[str, Query(min_length=3, max_length=120)], db: DB, settings: Cfg) -> list[GeocodeResult]:
    needle = q.strip().lower()
    local = [GeocodeResult(label=f"{c.name}, {c.area}", short_label=c.short_name, lat=c.lat, lng=c.lng, source="Nivasa college list")
             for c in db.scalars(select(College)) if needle in c.name.lower() or needle in c.short_name.lower()]
    geocoder = get_geocoder(settings)
    if geocoder is None:
        return local[:5]
    try:
        remote = geocoder.search(q.strip())
    except GeocoderUnavailable:
        if local:
            return local[:5]
        raise HTTPException(503, "Address search is unavailable right now. Pick a college or pin the map instead.") from None
    return (local + remote)[:8]
