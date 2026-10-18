"""Load reference data (colleges, OSM snapshot) and demo listings into the database.

Reference tables are replaced on every run. Demo listings and the hostels/PGs
imported from OpenStreetMap (ids ``osm-...``) are replaced; every other real
listing (submitted through the site) is never touched.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import College, DataSnapshot, Listing, MetroLine, MetroStation, MetroStop, Poi, RoomOption
from app.services.geo import Point, haversine_km

DATA_DIR = Path(__file__).parent / "data"


def _load(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def _dedupe_stations(items: list[dict]) -> list[dict]:
    """OSM maps some stations more than once (platform nodes, renamed duplicates). Keep one per ~150 m."""
    kept: list[dict] = []
    for s in sorted(items, key=lambda x: (x["status"] != "open", x["network"] is None, len(x["name"]))):
        if any(abs(k["lat"] - s["lat"]) < 0.0014 and abs(k["lng"] - s["lng"]) < 0.0014 for k in kept):
            continue
        kept.append(s)
    return kept


def _apply_hospital_contacts(rows: dict[str, Poi]) -> int:
    """Overlay hand-checked contacts for major hospitals onto their OSM entries."""
    data = _load("hospital_contacts.json")
    applied = 0
    for h in data["items"]:
        how = "the hospital's official website" if h["verified"] == "official" else "public directories (not an official page)"
        for ref in h["osm"]:
            poi = rows.get(ref)
            if poi is None:
                continue
            # Official contacts replace whatever OSM had; directory numbers only fill gaps.
            official = h["verified"] == "official"
            for field in ("phone", "email", "website", "address"):
                if h.get(field) and (official or not getattr(poi, field)):
                    setattr(poi, field, h[field])
            extra = dict(poi.details or {})
            if h.get("emergency_phone"):
                extra["emergency_phone"] = h["emergency_phone"]
            if h.get("note"):
                extra["note"] = h["note"]
            extra["emergency"] = extra.get("emergency", "yes") if h.get("emergency_phone") else extra.get("emergency", "")
            poi.details = {k: v for k, v in extra.items() if v} or None
            poi.contact_source = f"Checked {data['checked_on']} against {how}: {h['source_url']}"
            applied += 1
    return applied


STAY_PG = re.compile(r"\b(p\.?g\.?|pgs|paying guest|co-?living|zolo|stanza)\b", re.IGNORECASE)
STAY_GIRLS = re.compile(r"\b(girls?'?|ladies|women'?s?|womens|mahila)\b", re.IGNORECASE)
STAY_BOYS = re.compile(r"\b(boys?'?|gents|men'?s?)\b", re.IGNORECASE)
STAY_COED = re.compile(r"\b(co-?ed|unisex|men and women|boys and girls|boys & girls)\b", re.IGNORECASE)
# OSM names that matched "hostel"/"PG" but are not a place to live (PG = power grid on transmission lines).
NOT_A_STAY = re.compile(r"\b(\d+\s*kv|demolished|office|security|club house|road|cricket|academy|dharm?ashala|bung?low|"
                        r"asram|ashram|mess|canteen)\b", re.IGNORECASE)
# Bare campus building codes ("L-3", "West G", "O Building") tell a student nothing.
BUILDING_CODE = re.compile(
    r"^([a-z]{1,2}[\s-]?\d{0,3}|(west|east|north|south)\s\w|\w\s(building|block)|(bu?i?lding|block|wing)\s*\w{0,3})$",
    re.IGNORECASE)
STAY_CAMPUS = re.compile(r"\b(hostel\s*(no\.?|number)?\s*\d+|block|wing|hall of residence|iiser|coep|symbiosis|mit|vit|i2it|"
                         r"isquareit|diat|nda|afmc|college|university|institute|research)\b", re.IGNORECASE)


def seed_osm_stays(db: Session) -> int:
    """Real hostels and PGs mapped on OpenStreetMap, as listings with only the facts OSM has.

    Rent, rooms and rules are not on OSM, so they stay unknown and the listing says to call first.
    """
    data = _load("osm_stays.json")
    db.execute(delete(Listing).where(Listing.id.like("osm-%")))
    db.flush()  # the session does not autoflush, and the colleges were just replaced
    colleges = list(db.scalars(select(College)))
    seen: list[tuple[str, float, float]] = []
    count = 0
    for s in data["items"]:
        key = s["name"].lower()
        # OSM sometimes maps one stay twice (a node and a building). Keep one per name per ~150 m.
        if any(n == key and abs(la - s["lat"]) < 0.0015 and abs(ln - s["lng"]) < 0.0015 for n, la, ln in seen):
            continue
        seen.append((key, s["lat"], s["lng"]))
        name = s["name"]
        if NOT_A_STAY.search(name) or BUILDING_CODE.match(name.strip()):
            continue
        campus = bool(s.get("campus")) or bool(STAY_CAMPUS.search(name))
        girls, boys = bool(STAY_GIRLS.search(name)), bool(STAY_BOYS.search(name))
        gender = "coed" if STAY_COED.search(name) or (girls and boys) else "girls" if girls else "boys" if boys else None
        here = Point(s["lat"], s["lng"])
        near = min(colleges, key=lambda c: haversine_km(c, here)) if colleges else None
        if near and haversine_km(near, here) > 3:
            near = None
        suburb = (s.get("suburb") or "").strip(" ,")
        area = suburb[:1].upper() + suburb[1:] if suburb and suburb.lower() not in ("pune", "pune city") else \
            (f"Near {near.area}" if near else "Pune")
        amenities: dict[str, bool] = {}
        if s.get("internet_access") in ("wlan", "yes", "wifi"):
            amenities["wifi"] = True
        if s.get("air_conditioning") == "yes":
            amenities["ac"] = True
        note = ("Campus hostel: usually open only to students of that institution. " if campus else "") + \
            "Mapped on OpenStreetMap. Rent, room types and rules are not reported, so call before visiting."
        db.add(Listing(
            id=f"osm-{s['osm']}", name=name, stay_type="pg" if STAY_PG.search(name) else "hostel", gender=gender,
            area=area[:120], address=s.get("address"), lat=s["lat"], lng=s["lng"], location_precision="exact",
            description=note, amenities=amenities, safety={}, contact_name=s.get("operator"),
            contact_phone=s.get("phone"), contact_email=s.get("email"), contact_website=s.get("website"),
            is_demo=False, status="active", verification_status="unverified",
            data_source="OpenStreetMap contributors (ODbL)", rooms=[],
        ))
        count += 1
    db.add(DataSnapshot(key="osm_stays", source=data["source"], fetched_at=data["fetched_at"], record_count=count))
    return count


def seed_reference(db: Session) -> dict[str, int]:
    counts: dict[str, int] = {}
    colleges = _load("colleges.json")
    db.execute(delete(College))
    db.add_all(College(id=c["id"], name=c["name"], short_name=c["short_name"], area=c["area"], lat=c["lat"],
                       lng=c["lng"], osm_ref=c.get("osm_ref")) for c in colleges["items"])
    counts["colleges"] = len(colleges["items"])

    stations = _load("osm_stations.json")
    lines = _load("osm_metro_lines.json")
    db.execute(delete(MetroStop))
    db.execute(delete(MetroLine))
    db.execute(delete(MetroStation))
    kept = _dedupe_stations([s for s in stations["items"] if s.get("network") or s["status"] == "open"])
    db.add_all(MetroStation(id=s["osm"], name=s["name"], lat=s["lat"], lng=s["lng"], status=s["status"]) for s in kept)
    for l in lines["items"]:
        line = MetroLine(id=l["ref"], name=l["name"], colour=l.get("colour"), osm_ref=l.get("osm"))
        line.stops = [MetroStop(seq=i, name=s["name"], lat=s["lat"], lng=s["lng"]) for i, s in enumerate(l["stops"])]
        db.add(line)
    counts["metro_stations"] = len(kept)
    counts["metro_lines"] = len(lines["items"])

    pois = _load("osm_pois.json")
    db.execute(delete(Poi))
    osm_source = "OpenStreetMap contributors (ODbL)"
    rows = {p["osm"]: Poi(id=p["osm"], category=p["cat"], name=p.get("name"), lat=p["lat"], lng=p["lng"],
                          cuisine=p.get("cuisine"), pure_veg=p.get("pure_veg"), jain=p.get("jain"),
                          opening_hours=p.get("opening_hours"), phone=p.get("phone"), email=p.get("email"),
                          website=p.get("website"), address=p.get("address"), details=p.get("details"),
                          contact_source=osm_source if any(p.get(k) for k in ("phone", "email", "website")) else None)
            for p in pois["items"]}
    counts["hospital_contacts"] = _apply_hospital_contacts(rows)
    db.add_all(rows.values())
    counts["pois"] = len(rows)

    db.execute(delete(DataSnapshot))
    db.add_all([
        DataSnapshot(key="colleges", source=colleges["source"], fetched_at="2026-10-18", record_count=counts["colleges"]),
        DataSnapshot(key="metro", source=lines["source"], fetched_at=lines["fetched_at"], record_count=counts["metro_stations"]),
        DataSnapshot(key="pois", source=pois["source"], fetched_at=pois["fetched_at"], record_count=counts["pois"]),
    ])
    return counts


def seed_demo_listings(db: Session) -> int:
    data = _load("demo_listings.json")
    db.execute(delete(Listing).where(Listing.is_demo.is_(True)))
    for d in data["items"]:
        rooms = [RoomOption(sharing=r["sharing"], monthly_rent=r["monthly_rent"]) for r in d.pop("rooms")]
        db.add(Listing(**d, rooms=rooms, is_demo=True, status="active", verification_status="unverified",
                       data_source="Generated demo data (scripts/generate_demo_listings.py)"))
    db.add(DataSnapshot(key="demo_listings", source="Fictional demo listings for development",
                        fetched_at=date.today().isoformat(), record_count=len(data["items"])))
    return len(data["items"])


def seed_all(db: Session, include_demo: bool = True) -> dict[str, int]:
    counts = seed_reference(db)
    counts["osm_stays"] = seed_osm_stays(db)
    if include_demo:
        counts["demo_listings"] = seed_demo_listings(db)
    else:
        db.execute(delete(Listing).where(Listing.is_demo.is_(True)))
    db.commit()
    return counts
