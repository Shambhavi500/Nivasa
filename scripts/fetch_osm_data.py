"""Download a snapshot of real Pune map data from OpenStreetMap (Overpass API).

Writes normalised JSON files into backend/app/seed/data/ that the seed command
loads into the database:

    osm_stations.json      Pune Metro stations (open and under construction)
    osm_institutions.json  colleges and universities (for picking destinations)
    osm_pois.json          daily essentials, messes, police stations, hospitals (with contacts)
    osm_stays.json         hostels, PGs and student housing mapped on OSM (with contacts)

Data © OpenStreetMap contributors, available under the ODbL.
Run from the repository root:

    python scripts/fetch_osm_data.py              # everything
    python scripts/fetch_osm_data.py pois stays   # only some datasets

Only the standard library is used, so no virtualenv is needed.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Nivasa-data-snapshot/0.1 (student housing discovery, Pune)"

# Pune Metropolitan Region, roughly Talegaon to Loni Kalbhor, Chakan to Khadakwasla.
SOUTH, WEST, NORTH, EAST = 18.35, 73.65, 18.78, 74.10
BBOX = f"{SOUTH},{WEST},{NORTH},{EAST}"

OUT_DIR = Path(__file__).resolve().parents[1] / "backend" / "app" / "seed" / "data"

MESS_NAME = re.compile(
    r"\b(mess|khanaval|khanawal|khanavali|khanawali|bhojan|bhojanalay|bhojanalaya|bhojnalay|bhojnalaya|tiffin|thali"
    r"|dabba|annapurna|dining hall|lunch home|meals|poli bhaji)\b",
    re.IGNORECASE,
)

STAY_NAME = re.compile(r"\b(hostel|hostels|p\.?g\.?|pgs|paying guest|co-?living|hall of residence|stanza|zolo)\b", re.IGNORECASE)
NOT_STUDENT_STAY = re.compile(r"\b(guest house|touring officers|circuit house|rest house|dharamshala|hotel)\b", re.IGNORECASE)


def first(t: dict, *keys: str) -> str | None:
    for k in keys:
        v = (t.get(k) or "").strip()
        if v:
            return v
    return None


def address(t: dict) -> str | None:
    full = first(t, "addr:full")
    if full:
        return full
    house = " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:housename")) if v)
    parts = [house, t.get("addr:street"), t.get("addr:place"), t.get("addr:suburb"), t.get("addr:city"), t.get("addr:postcode")]
    return ", ".join(p.strip() for p in parts if p and p.strip()) or None


def contact(t: dict) -> dict:
    """The ways to reach a place, exactly as mapped. Missing ones are left out, never guessed."""
    c = {
        "phone": first(t, "phone", "contact:phone", "mobile", "contact:mobile", "phone:mobile"),
        "email": first(t, "email", "contact:email"),
        "website": first(t, "website", "contact:website", "url"),
        "address": address(t),
        "opening_hours": first(t, "opening_hours"),
    }
    return {k: v for k, v in c.items() if v}


def details(t: dict) -> dict | None:
    """A few extra facts worth showing on a place card."""
    d = {
        "kind": first(t, "healthcare", "amenity", "shop", "leisure"),
        "speciality": first(t, "healthcare:speciality"),
        "emergency": first(t, "emergency"),
        "operator": first(t, "operator"),
        "operator_type": first(t, "operator:type"),
        "beds": first(t, "beds", "capacity:beds"),
        "wheelchair": first(t, "wheelchair"),
        "description": first(t, "description"),
        "name_mr": first(t, "name:mr"),
        "takeaway": first(t, "takeaway"),
        "delivery": first(t, "delivery"),
    }
    if d["speciality"]:
        d["speciality"] = ", ".join(s.strip().replace("_", " ") for s in d["speciality"].split(";") if s.strip())
    return {k: v for k, v in d.items() if v} or None


def overpass(query: str) -> list[dict]:
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                return json.load(resp)["elements"]
        except Exception as exc:  # network hiccups and 429s are common on the public instance
            if attempt == 2:
                raise
            print(f"  overpass error ({exc}); retrying in 20 s", file=sys.stderr)
            time.sleep(20)
    return []


def coords(el: dict) -> tuple[float, float] | None:
    if "lat" in el:
        return el["lat"], el["lon"]
    if "center" in el:
        return el["center"]["lat"], el["center"]["lon"]
    return None


def osm_ref(el: dict) -> str:
    return f"{el['type'][0]}{el['id']}"


def fetch_stations() -> list[dict]:
    q = f"""[out:json][timeout:120];
    (node["railway"="station"]["station"="subway"]({BBOX});
     node["construction"="station"]["station"="subway"]({BBOX}););
    out;"""
    out = []
    for el in overpass(q):
        t = el.get("tags", {})
        name = t.get("name:en") or t.get("name")
        if not name:
            continue
        out.append({
            "osm": osm_ref(el),
            "name": name,
            "name_mr": t.get("name:mr"),
            "lat": el["lat"],
            "lng": el["lon"],
            "network": t.get("network"),
            "status": "construction" if t.get("construction") or t.get("railway") == "construction" else "open",
        })
    return sorted(out, key=lambda s: s["name"])


def fetch_lines() -> list[dict]:
    """Operational metro lines as ordered stop lists, from OSM route relations."""
    q = f"""[out:json][timeout:120];
    relation["route"~"^(subway|light_rail)$"]["network"~"Pune Metro",i]({BBOX});
    out body;node(r:"stop");out;node(r:"stop_entry_only");out;node(r:"stop_exit_only");out;"""
    elements = overpass(q)
    nodes = {e["id"]: e for e in elements if e["type"] == "node"}
    lines: dict[str, dict] = {}
    for rel in (e for e in elements if e["type"] == "relation"):
        t = rel.get("tags", {})
        ref = t.get("ref") or t.get("name")
        if ref in lines:  # each line has one relation per direction; keep the first
            continue
        stops = []
        for m in rel["members"]:
            if m["type"] != "node" or not m["role"].startswith("stop") or m["ref"] not in nodes:
                continue
            n = nodes[m["ref"]]
            nt = n.get("tags", {})
            stops.append({"osm": f"n{n['id']}", "name": nt.get("name:en") or nt.get("name"),
                          "lat": n["lat"], "lng": n["lon"]})
        if len(stops) < 2:
            continue
        name = (t.get("name") or ref).split(":")[0].strip()
        lines[ref] = {"ref": ref, "name": name, "colour": t.get("colour"), "osm": f"r{rel['id']}", "stops": stops}
    return sorted(lines.values(), key=lambda l: l["ref"])


def fetch_institutions() -> list[dict]:
    q = f"""[out:json][timeout:180];
    (nwr["amenity"~"^(university|college)$"]["name"]({BBOX}););
    out center tags;"""
    out = []
    for el in overpass(q):
        c = coords(el)
        t = el.get("tags", {})
        if not c:
            continue
        out.append({
            "osm": osm_ref(el),
            "name": t.get("name:en") or t["name"],
            "kind": t["amenity"],
            "lat": round(c[0], 6),
            "lng": round(c[1], 6),
            "addr": ", ".join(v for k, v in t.items() if k in ("addr:street", "addr:suburb", "addr:city")) or None,
        })
    return sorted(out, key=lambda s: s["name"])


POI_RULES: list[tuple[str, str]] = [
    # (category, overpass filter)
    ("grocery", '["shop"~"^(supermarket|convenience|general|grocery|kiosk)$"]'),
    ("vegetables", '["shop"="greengrocer"]'),
    ("vegetables", '["amenity"="marketplace"]'),
    ("pharmacy", '["amenity"="pharmacy"]'),
    ("pharmacy", '["shop"="chemist"]'),
    ("stationery", '["shop"~"^(stationery|copyshop|books)$"]'),
    ("laundry", '["shop"~"^(laundry|dry_cleaning)$"]'),
    ("atm", '["amenity"~"^(atm|bank)$"]'),
    ("gym", '["leisure"="fitness_centre"]'),
    ("library", '["amenity"="library"]'),
    ("hospital", '["amenity"~"^(hospital|clinic|doctors)$"]'),
    ("police", '["amenity"="police"]'),
]


def fetch_pois() -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for cat, flt in POI_RULES:
        print(f"  {cat} {flt}")
        q = f'[out:json][timeout:180];(nwr{flt}({BBOX}););out center tags;'
        for el in overpass(q):
            ref = osm_ref(el)
            c = coords(el)
            if not c or ref in seen:
                continue
            seen.add(ref)
            t = el.get("tags", {})
            out.append({"osm": ref, "cat": cat, "name": t.get("name:en") or t.get("name"),
                        "lat": round(c[0], 6), "lng": round(c[1], 6), **contact(t), "details": details(t)})
        time.sleep(2)

    print("  messes (food places whose name says mess, khanaval, tiffin ...)")
    q = f'[out:json][timeout:180];(nwr["amenity"~"^(restaurant|fast_food|food_court|cafe)$"]["name"]({BBOX}););out center tags;'
    for el in overpass(q):
        t = el.get("tags", {})
        name = t.get("name:en") or t.get("name") or ""
        c = coords(el)
        if not c or not MESS_NAME.search(name):
            continue
        cuisine = [s.strip().replace("_", " ") for s in re.split(r"[;,]", t.get("cuisine", "")) if s.strip()]
        veg = t.get("diet:vegetarian")
        out.append({
            "osm": osm_ref(el), "cat": "mess", "name": name, "lat": round(c[0], 6), "lng": round(c[1], 6),
            "cuisine": cuisine or None,
            # OSM diet tags are tri-state: only/yes/no. Anything missing stays unknown.
            "pure_veg": True if veg == "only" else False if veg in ("no", "yes") else None,
            "jain": True if t.get("diet:jain") in ("yes", "only") else False if t.get("diet:jain") == "no" else None,
            **contact(t),
            "details": details(t),
        })
    return out


def fetch_stays() -> list[dict]:
    """Hostels, PGs and student housing mapped on OSM. Rent, rooms and rules are not on OSM."""
    q = f"""[out:json][timeout:180];
    (nwr["tourism"="hostel"]({BBOX});
     nwr["tourism"="guest_house"]["name"~"(hostel|PG|paying guest|co-?living)",i]({BBOX});
     nwr["amenity"~"^(dormitory|student_accommodation|hostel)$"]({BBOX});
     nwr["building"~"^(dormitory|student_accommodation)$"]["name"]({BBOX});
     nwr["name"~"(hostel|paying guest|\\\\bPG\\\\b|co-?living)",i][!"highway"][!"amenity"]({BBOX}););
    out center tags;"""
    out: list[dict] = []
    for el in overpass(q):
        t = el.get("tags", {})
        name = (t.get("name:en") or t.get("name") or "").strip()
        c = coords(el)
        if not c or not name or NOT_STUDENT_STAY.search(name):
            continue
        tagged = t.get("tourism") == "hostel" or t.get("amenity") in ("dormitory", "student_accommodation", "hostel") \
            or t.get("building") in ("dormitory", "student_accommodation")
        if not (tagged or STAY_NAME.search(name)):
            continue
        out.append({"osm": osm_ref(el), "name": name, "lat": round(c[0], 6), "lng": round(c[1], 6),
                    "operator": t.get("operator"), "suburb": first(t, "addr:suburb", "addr:city"),
                    "internet_access": t.get("internet_access"), "air_conditioning": t.get("air_conditioning"),
                    "campus": t.get("amenity") in ("college", "university") or t.get("building") == "dormitory",
                    **contact(t)})
    time.sleep(2)
    places = fetch_places()
    for s in out:
        s["locality"] = nearest_place(places, s["lat"], s["lng"])
    return sorted(out, key=lambda s: s["name"].lower())


def fetch_places() -> list[tuple[str, float, float]]:
    """Named suburbs, neighbourhoods and villages, used to say which part of Pune a stay is in."""
    q = f"""[out:json][timeout:120];
    node["place"~"^(suburb|neighbourhood|quarter|village|town)$"]["name"]({BBOX});
    out;"""
    return [((el["tags"].get("name:en") or el["tags"]["name"]).strip(), el["lat"], el["lon"]) for el in overpass(q)]


def nearest_place(places: list[tuple[str, float, float]], lat: float, lng: float, max_km: float = 3.0) -> str | None:
    best, best_km = None, max_km
    for name, plat, plng in places:
        km = 111.2 * math.hypot(plat - lat, (plng - lng) * math.cos(math.radians(lat)))
        if km < best_km:
            best, best_km = name, km
    return best


def write(name: str, payload: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


def main() -> None:
    meta = {
        "source": "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "bbox": [SOUTH, WEST, NORTH, EAST],
    }
    wanted = set(sys.argv[1:]) or {"stations", "lines", "institutions", "pois", "stays"}
    if "stations" in wanted:
        print("Fetching metro stations")
        write("osm_stations.json", {**meta, "items": fetch_stations()})
        time.sleep(3)
    if "lines" in wanted:
        print("Fetching metro lines")
        write("osm_metro_lines.json", {**meta, "items": fetch_lines()})
        time.sleep(3)
    if "institutions" in wanted:
        print("Fetching colleges and universities")
        write("osm_institutions.json", {**meta, "items": fetch_institutions()})
        time.sleep(3)
    if "pois" in wanted:
        print("Fetching points of interest")
        pois = fetch_pois()
        write("osm_pois.json", {**meta, "items": pois})
        counts: dict[str, int] = {}
        for p in pois:
            counts[p["cat"]] = counts.get(p["cat"], 0) + 1
        print("POI counts:", counts)
        time.sleep(3)
    if "stays" in wanted:
        print("Fetching hostels and PGs")
        stays = fetch_stays()
        write("osm_stays.json", {**meta, "items": stays})
        print("Stays:", len(stays))


if __name__ == "__main__":
    main()
