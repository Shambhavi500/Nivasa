"""Download hostels and PGs in the Pune region from Overture Maps Places.

Overture merges places from Meta, Microsoft, Foursquare and others, so it lists many
PGs that are not on OpenStreetMap. Writes backend/app/seed/data/overture_stays.json,
which the seed command merges with the OpenStreetMap stays.

Data © Overture Maps Foundation, CDLA Permissive 2.0 (https://docs.overturemaps.org/attribution/).
Run from the repository root (needs pyarrow: pip install pyarrow):

    python scripts/fetch_overture_stays.py               # latest release
    python scripts/fetch_overture_stays.py 2026-10-21.0  # a specific release
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.dataset as ds
from fetch_osm_data import fetch_places, nearest_place
from pyarrow import fs

BUCKET, REGION = "overturemaps-us-west-2", "us-west-2"
USER_AGENT = "Nivasa-data-snapshot/0.1 (student housing discovery, Pune)"

# Same region as scripts/fetch_osm_data.py.
SOUTH, WEST, NORTH, EAST = 18.35, 73.65, 18.78, 74.10

OUT = Path(__file__).resolve().parents[1] / "backend" / "app" / "seed" / "data" / "overture_stays.json"

# Overture's taxonomy files PGs, co-living and student hostels under "hostel". A place named as a hostel or PG
# also counts when it is filed under a neighbouring category (or none), but not as a hotel, vet or dentist.
NAMED_STAY_CATEGORIES = {None, "hostel", "lodging", "guest_house", "service_apartment", "lodge", "college_university",
                         "education", "social_or_community_service", "home_service", "property_management"}
STAY_NAME = re.compile(r"\b(hostel|hostels|p\.?g\.?|pgs|paying guest|co-?living|zolo|stanza|chhatralaya|vasatigruha)\b",
                       re.IGNORECASE)
NOT_A_STAY = re.compile(r"\b(hotel|resort|guest house|dharm?ashala|agency|agent|broker|consultants?|real estate|properties"
                        r"|realty|office|school|academy|classes|tuition|hospital|jewell?ers|mess|balgram|trust|kv"
                        r"|oyo \d+)\b", re.IGNORECASE)
MIN_CONFIDENCE = 0.5


def latest_release() -> str:
    url = f"https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        releases = re.findall(r"<Prefix>release/([^<]+)/</Prefix>", resp.read().decode())
    return sorted(releases)[-1]


def first(values: list | None) -> str | None:
    return values[0] if values else None


def fetch(release: str) -> list[dict]:
    s3 = fs.S3FileSystem(anonymous=True, region=REGION)
    dataset = ds.dataset(f"{BUCKET}/release/{release}/theme=places/type=place/", filesystem=s3, format="parquet")
    names = set(dataset.schema.names)
    cols = [c for c in ("id", "bbox", "names", "taxonomy", "confidence", "websites", "phones", "emails",
                        "addresses", "sources", "operating_status") if c in names]
    in_box = ((pc.field("bbox", "xmin") >= WEST) & (pc.field("bbox", "xmax") <= EAST)
              & (pc.field("bbox", "ymin") >= SOUTH) & (pc.field("bbox", "ymax") <= NORTH))
    print(f"Reading Overture {release} places in the Pune region (a few minutes)")
    rows = dataset.to_table(columns=cols, filter=in_box).to_pylist()
    print(f"  {len(rows)} places in the region")

    places = fetch_places()
    out: list[dict] = []
    for r in rows:
        full = " ".join(((r.get("names") or {}).get("primary") or "").split())
        category = (r.get("taxonomy") or {}).get("primary")
        if not full or (r.get("confidence") or 0) < MIN_CONFIDENCE or r.get("operating_status") in ("closed", "permanently_closed"):
            continue
        if NOT_A_STAY.search(full) or not (category == "hostel" or (category in NAMED_STAY_CATEGORIES and STAY_NAME.search(full))):
            continue
        # "Stanza Living Karlsruhe House | Unisex PG in Wakad": the part after "|" is a tagline.
        name, _, tagline = (p.strip() for p in full.partition("|"))
        addr = first(r.get("addresses")) or {}
        b = r["bbox"]
        lat, lng = round((b["ymin"] + b["ymax"]) / 2, 6), round((b["xmin"] + b["xmax"]) / 2, 6)
        out.append({
            "id": r["id"],
            "name": name or full,
            "tagline": tagline or None,
            "lat": lat,
            "lng": lng,
            "category": category,
            "confidence": round(r.get("confidence") or 0, 2),
            "phone": first(r.get("phones")),
            "email": first(r.get("emails")),
            "website": first(r.get("websites")),
            "address": addr.get("freeform"),
            "locality": nearest_place(places, lat, lng) or addr.get("locality"),
            "sources": sorted({s.get("dataset") for s in (r.get("sources") or []) if s.get("dataset")} - {"Overture"}),
        })
    return sorted(out, key=lambda s: s["name"].lower())


def main() -> None:
    release = sys.argv[1] if len(sys.argv) > 1 else latest_release()
    items = fetch(release)
    OUT.write_text(json.dumps({
        "source": f"© Overture Maps Foundation, CDLA Permissive 2.0, release {release} "
                  "(https://docs.overturemaps.org/attribution/)",
        "fetched_at": release,
        "bbox": [SOUTH, WEST, NORTH, EAST],
        "items": items,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({len(items)} stays)")


if __name__ == "__main__":
    main()
