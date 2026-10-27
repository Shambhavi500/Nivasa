"""Load reference data (colleges, OSM snapshot) and demo listings into the database.

Reference tables are replaced on every run. Demo listings and the hostels/PGs
imported from OpenStreetMap and Overture Maps (ids ``osm-...``/``ovt-...``) are
replaced; every other real listing (submitted through the site) is never touched.
"""

from __future__ import annotations

import json
import math
import re
from datetime import date
from pathlib import Path

from sqlalchemy import delete, or_
from sqlalchemy.orm import Session

from app.models import College, DataSnapshot, Listing, MetroLine, MetroStation, MetroStop, Poi, RoomOption

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


OSM_SOURCE = "OpenStreetMap"
OVERTURE_SOURCE = "Overture Maps"

# Map features caught by the name filters that are not places to stay (power-grid lines, offices, ruins ...).
_NOT_A_STAY = re.compile(r"\b(kv|demolished|office|security|club house|bunglow|dharm?ashala|cricket|school of design|road)\b",
                         re.IGNORECASE)
# Names made only of these words ("Boys Hostel No. 2", "L Block") cannot be told apart or looked up.
_GENERIC = {"boys", "boy", "girls", "girl", "ladies", "gents", "hostel", "hostle", "hostels", "hostells", "block", "no",
            "building", "bulding", "new", "old", "main", "wing", "for", "research", "student", "students", "hall", "west",
            "east", "pg", "in", "pune", "and"}
_PG = re.compile(r"\b(p\.?g\.?|pgs|paying guest|co-?living|zolo|stanza|oyo life|living|homes|rooms|studio)\b", re.IGNORECASE)
_COED = re.compile(r"\b(unisex|co-?ed|men and women|ladies (and|&) gents|boys (and|&) girls)\b", re.IGNORECASE)
_GIRLS = re.compile(r"\b(girls?|girl's|ladies|women'?s?|womens|kanya|her)\b", re.IGNORECASE)
_BOYS = re.compile(r"\b(boys?|boy's|boyes|gents|men'?s?|mens)\b", re.IGNORECASE)
_CAMPUS = re.compile(r"\b(college|institute|university|iiser|coep|symbiosis|sinhgad|medical|fergusson|wadia|mit|jspm|pccoe"
                     r"|pict|i2it|isquareit|nicmar|ftii|ncl|diat|raisoni|ayurveda|bjs?|mvpm|zeal|ari|hall of residence"
                     r"|afmc|iricen|gokhale|sndt|bharati|vishwakarma|vit|d\s?y\s?patil|nursing|cadets?)\b",
                     re.IGNORECASE)
# Words that say nothing about which stay it is, ignored when matching names across sources.
_NAME_NOISE = {"pune", "the", "and", "in", "for", "pg", "hostel", "hostels", "boys", "girls", "ladies", "gents", "co",
               "living", "coliving", "house", "near", "services", "service", "accommodation"}
_SAME_PLACE_KM = 0.3
# Meta and Microsoft sometimes place the same named stay a short way apart.
_SAME_NAME_KM = 1.5


def _is_generic(name: str) -> bool:
    words = re.findall(r"[^\W\d_]+", name.lower())
    return all(w in _GENERIC or len(w) == 1 for w in words)


def _gender(text: str) -> str | None:
    if _COED.search(text):
        return "coed"
    girls, boys = bool(_GIRLS.search(text)), bool(_BOYS.search(text))
    return "coed" if girls and boys else "girls" if girls else "boys" if boys else None


def _tri(value: str | None, yes: tuple[str, ...]) -> bool | None:
    if not value:
        return None
    return True if value.lower() in yes else False if value.lower() == "no" else None


def _words(name: str) -> list[str]:
    return re.findall(r"[^\W_]+", re.sub(r"[.'’]", "", name.lower()))  # "B.J." -> "bj", "Girl's" -> "girls"


def _name_key(name: str) -> set[str]:
    return {w for w in _words(name) if w not in _NAME_NOISE}


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone)[-10:]


def _km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    return 111.2 * math.hypot(a_lat - b_lat, (a_lng - b_lng) * math.cos(math.radians(a_lat)))


def _same_stay(a: Listing, name: str, lat: float, lng: float, phone: str | None = None,
               shared_phones: frozenset[str] = frozenset()) -> bool:
    """Whether a new record describes stay ``a``.

    Boys' and girls' blocks are never the same stay. Otherwise: the same name within 1.5 km, or within
    300 m either the same phone (unless it is a call centre shared by several stays) or mostly the same
    distinctive words in the name ("Zolo Highrollers" and "Zolo Highrollers - PG in Hinjewadi").
    """
    gender = _gender(name)
    if a.gender and gender and a.gender != gender:
        return False
    km = _km(a.lat, a.lng, lat, lng)
    if km <= _SAME_NAME_KM and _words(a.name) == _words(name) and not _is_generic(name):
        return True
    if km > _SAME_PLACE_KM:
        return False
    if phone and a.contact_phone and _digits(phone) == _digits(a.contact_phone) and _digits(phone) not in shared_phones:
        return True
    ka, kb = _name_key(a.name), _name_key(name)
    if not ka or not kb:
        return False
    small = min(len(ka), len(kb))
    return len(ka & kb) / len(ka | kb) >= 0.6 or (small >= 2 and len(ka & kb) == small)


def _stay(id: str, name: str, lat: float, lng: float, area: str | None, notes: list[str], source: str,
          hints: str = "", **facts) -> Listing:
    if _CAMPUS.search(name):
        notes.append("Looks like an institute hostel, usually open only to that institute's students.")
    text = f"{name} {hints}"
    return Listing(
        id=id, name=name, stay_type="pg" if _PG.search(text) else "hostel", gender=_gender(text),
        area=(area or "Pune").strip(" ,"), lat=lat, lng=lng, location_precision="exact", description=" ".join(notes),
        safety={}, is_demo=False, status="active", verification_status="unverified", data_source=source, rooms=[],
        **{"amenities": {}, **facts},
    )


def osm_listings(items: list[dict]) -> list[Listing]:
    """Real stays mapped on OpenStreetMap. OSM has no rent, rooms or house rules, so those stay unknown."""
    out: list[Listing] = []
    for s in items:
        name = s["name"]
        if _NOT_A_STAY.search(name) or _is_generic(name):
            continue
        # The same building is sometimes mapped as both a node and an outline, or twice under spellings.
        if any(_same_stay(l, name, s["lat"], s["lng"]) for l in out):
            continue
        amenities = {k: v for k, v in (("wifi", _tri(s.get("internet_access"), ("yes", "wlan", "wifi"))),
                                       ("ac", _tri(s.get("air_conditioning"), ("yes",)))) if v is not None}
        notes = [f"Mapped on OpenStreetMap ({s['osm']}). Rent, rooms and rules are not on the map: "
                 "call or visit to confirm before deciding."]
        if s.get("campus") and not _CAMPUS.search(name):
            notes.append("Looks like an institute hostel, usually open only to that institute's students.")
        if s.get("operator"):
            notes.append(f"Operator: {s['operator']}.")
        suburb = s.get("suburb") if (s.get("suburb") or "").lower() not in ("", "pune") else None
        out.append(_stay(f"osm-{s['osm']}", name, s["lat"], s["lng"], suburb or s.get("locality"), notes, OSM_SOURCE,
                         address=s.get("address"), amenities=amenities, contact_phone=s.get("phone"),
                         contact_email=s.get("email"), contact_website=s.get("website")))
    return out


def overture_listings(items: list[dict], known: list[Listing]) -> tuple[list[Listing], int]:
    """Stays from Overture Maps Places that are not already in ``known``.

    A stay already known (usually from OpenStreetMap) gains Overture's phone or email if it has none.
    Returns the new listings and how many known ones gained a phone number.
    """
    out: list[Listing] = []
    enriched = 0
    names_by_phone: dict[str, set[str]] = {}
    for s in items:
        if s.get("phone"):
            names_by_phone.setdefault(_digits(s["phone"]), set()).add(s["name"].lower())
    shared = frozenset(p for p, names in names_by_phone.items() if len(names) >= 3)
    for s in sorted(items, key=lambda s: -s.get("confidence", 0)):
        name = s["name"]
        if _NOT_A_STAY.search(name) or _is_generic(name):
            continue
        twin = next((l for l in known if _same_stay(l, name, s["lat"], s["lng"], s.get("phone"), shared)), None)
        if twin is not None:
            if not twin.contact_phone and s.get("phone"):
                twin.contact_phone, enriched = s["phone"], enriched + 1
            if not twin.contact_email and s.get("email"):
                twin.contact_email = s["email"]
            if not twin.contact_website and s.get("website"):
                twin.contact_website = s["website"]
            continue
        # Meta and Microsoft often list the same stay; keep the most confident one.
        if any(_same_stay(l, name, s["lat"], s["lng"], s.get("phone"), shared) for l in out):
            continue
        via = " and ".join(x.capitalize() if x.islower() else x for x in s.get("sources") or []) or "its partners"
        notes = [f"Listed in Overture Maps (from {via}). Rent, rooms and rules are not listed: "
                 "call or visit to confirm before deciding."]
        if s.get("tagline"):
            notes.append(f"Advertised as \"{s['tagline']}\".")
        out.append(_stay(f"ovt-{s['id'][:16]}", name, s["lat"], s["lng"], s.get("locality"), notes, OVERTURE_SOURCE,
                         hints=s.get("tagline") or "", address=s.get("address"), contact_phone=s.get("phone"),
                         contact_email=s.get("email"), contact_website=s.get("website")))
    return out, enriched


def seed_real_listings(db: Session) -> dict[str, int]:
    osm, ovt = _load("osm_stays.json"), _load("overture_stays.json")
    # Older seeds labelled OSM stays differently, so match their ids too.
    db.execute(delete(Listing).where(or_(Listing.data_source.in_([OSM_SOURCE, OVERTURE_SOURCE]),
                                         Listing.id.like("osm-%"), Listing.id.like("ovt-%"))))
    from_osm = osm_listings(osm["items"])
    from_ovt, enriched = overture_listings(ovt["items"], from_osm)
    db.add_all(from_osm + from_ovt)
    db.add_all([
        DataSnapshot(key="osm_stays", source=osm["source"], fetched_at=osm["fetched_at"], record_count=len(from_osm)),
        DataSnapshot(key="overture_stays", source=ovt["source"], fetched_at=ovt["fetched_at"], record_count=len(from_ovt)),
    ])
    return {"osm_listings": len(from_osm), "overture_listings": len(from_ovt), "osm_given_phone": enriched}


def seed_all(db: Session, include_demo: bool = True) -> dict[str, int]:
    counts = seed_reference(db)
    counts.update(seed_real_listings(db))
    if include_demo:
        counts["demo_listings"] = seed_demo_listings(db)
    else:
        db.execute(delete(Listing).where(Listing.is_demo.is_(True)))
    db.commit()
    return counts
