from __future__ import annotations

from app.config import get_settings

from .conftest import prefs


def test_health_and_meta(client):
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    assert "metro" in meta["modes"] and "wifi" in meta["amenities"]
    assert {d["key"] for d in meta["datasets"]} >= {"colleges", "metro", "pois"}
    assert meta["geocoder_enabled"] is False


def test_colleges_have_real_coordinates(client):
    colleges = client.get("/api/colleges").json()
    assert len(colleges) >= 30
    coep = next(c for c in colleges if c["id"] == "coep")
    assert coep["osm_ref"] and 18.52 < coep["lat"] < 18.54


def test_transit_lines_and_stations(client):
    t = client.get("/api/transit").json()
    assert {l["name"] for l in t["lines"]} == {"Purple Line", "Aqua Line"}
    assert any(s["status"] == "construction" for s in t["stations"])


def test_search_returns_ranked_explained_results(client):
    r = client.post("/api/search", json=prefs())
    assert r.status_code == 200
    body = r.json()
    assert body["destination"]["short_label"] == "COEP"
    assert body["results"], "expected demo listings near COEP"
    scores = [x["score"] for x in body["results"] if x["score"] is not None]
    assert scores == sorted(scores, reverse=True)
    first = body["results"][0]
    assert first["reasons"] and len(first["factors"]) == 6
    assert all(not x["hidden_reasons"] for x in body["results"])
    assert body["includes_demo"] is True


def test_search_with_custom_point(client):
    p = prefs(destination={"lat": 18.5913, "lng": 73.7389, "label": "Hinjewadi Phase 1"})
    body = client.post("/api/search", json=p).json()
    assert body["destination"]["college_id"] is None
    assert body["destination"]["label"] == "Hinjewadi Phase 1"


def test_search_validation_errors(client):
    assert client.post("/api/search", json=prefs(destination={})).status_code == 422
    assert client.post("/api/search", json=prefs(destination={"lat": 19.07, "lng": 72.88})).status_code == 422
    assert client.post("/api/search", json=prefs(budget=500)).status_code == 422
    assert client.post("/api/search", json=prefs(modes=[])).status_code == 422
    assert client.post("/api/search", json=prefs(cuisines=["Pizza"])).status_code == 422
    assert client.post("/api/search", json=prefs(weights={"budget": 0, "commute": 0, "food": 0, "facilities": 0,
                                                           "market": 0, "safety": 0})).status_code == 422
    assert client.post("/api/search", json=prefs(destination={"college_id": "nope"})).status_code == 422
    assert client.post("/api/search", json={**prefs(), "unexpected": 1}).status_code == 422


def test_listing_detail_and_match(client):
    body = client.post("/api/search", json=prefs()).json()
    lid = body["results"][0]["listing"]["id"]
    assert client.get(f"/api/listings/{lid}").json()["id"] == lid
    m = client.post(f"/api/listings/{lid}/match", json=prefs()).json()
    assert m["listing"]["id"] == lid and len(m["commute"]["options"]) == 6
    assert client.get("/api/listings/does-not-exist").status_code == 404


def test_report_listing(client):
    lid = client.post("/api/search", json=prefs()).json()["results"][0]["listing"]["id"]
    r = client.post(f"/api/listings/{lid}/reports", json={"topic": "rent", "message": "Rent went up last month"})
    assert r.status_code == 201
    assert client.post(f"/api/listings/{lid}/reports", json={"topic": "rent", "message": "x"}).status_code == 422


def test_pois_requires_small_bbox(client):
    ok = client.get("/api/pois", params={"south": 18.52, "west": 73.84, "north": 18.54, "east": 73.87})
    assert ok.status_code == 200 and isinstance(ok.json(), list)
    cats = client.get("/api/pois", params={"south": 18.40, "west": 73.70, "north": 18.70, "east": 74.00})
    assert cats.status_code == 422


def test_submission_is_hidden_until_approved(client, monkeypatch):
    sub = {"name": "Real Test PG", "stay_type": "pg", "gender": "boys", "area": "Shivajinagar",
           "lat": 18.5310, "lng": 73.8500, "rooms": [{"sharing": "double", "monthly_rent": 9000}],
           "contact_phone": "+91 98765 43210"}
    r = client.post("/api/submissions", json=sub)
    assert r.status_code == 201
    sid = r.json()["id"]
    assert client.get(f"/api/listings/{sid}").status_code == 404
    ids = {x["listing"]["id"] for x in client.post("/api/search", json=prefs()).json()["results"]}
    assert sid not in ids

    assert client.get("/api/admin/submissions").status_code == 403  # admin disabled without a key
    monkeypatch.setenv("NIVASA_ADMIN_API_KEY", "test-key")
    get_settings.cache_clear()
    assert client.get("/api/admin/submissions", headers={"X-Admin-Key": "wrong"}).status_code == 401
    pending = client.get("/api/admin/submissions", headers={"X-Admin-Key": "test-key"}).json()
    assert any(p["id"] == sid for p in pending)
    assert client.post(f"/api/admin/submissions/{sid}/approve", headers={"X-Admin-Key": "test-key"}).json()["status"] == "active"
    assert client.get(f"/api/listings/{sid}").json()["is_demo"] is False


def test_submission_validation(client):
    bad = {"name": "X PG", "stay_type": "pg", "area": "Mumbai", "lat": 19.07, "lng": 72.88}
    assert client.post("/api/submissions", json=bad).status_code == 422
    bad_phone = {"name": "Y PG", "stay_type": "pg", "area": "Kothrud", "lat": 18.50, "lng": 73.81, "contact_phone": "call me"}
    assert client.post("/api/submissions", json=bad_phone).status_code == 422


def test_geocode_falls_back_to_college_list(client):
    r = client.get("/api/geocode", params={"q": "fergusson"})
    assert r.status_code == 200 and r.json()[0]["short_label"] == "Fergusson"
    assert client.get("/api/geocode", params={"q": "ab"}).status_code == 422


def test_poi_detail_has_researched_hospital_contacts(client):
    # Jehangir Hospital (OSM w331500153): contacts checked against the hospital's own website.
    p = client.get("/api/pois/w331500153").json()
    assert p["category"] == "hospital" and p["phone"] and p["email"] == "info@jehangirhospital.com"
    assert p["details"]["emergency_phone"] and "official website" in p["contact_source"]
    assert client.get("/api/pois/n0").status_code == 404


def test_pois_carry_mapped_contacts(client):
    rows = client.get("/api/pois", params={"south": 18.5, "west": 73.83, "north": 18.56, "east": 73.9,
                                           "categories": "hospital", "limit": 2000}).json()
    assert any(r["phone"] for r in rows) and any(r["address"] for r in rows)


def test_osm_stays_are_real_listings_without_invented_facts(client, db):
    from sqlalchemy import select

    from app.models import Listing

    stays = list(db.scalars(select(Listing).where(Listing.id.like("osm-%"))))
    assert len(stays) > 50
    assert all(not s.is_demo and not s.rooms and s.status == "active" for s in stays)
    assert any(s.contact_phone for s in stays)
    body = client.get(f"/api/listings/{stays[0].id}").json()
    assert body["is_demo"] is False and body["rooms"] == []


def test_osm_stays_become_real_listings_without_guessed_rent() -> None:
    from app.seed import osm_listings

    raw = [
        {"osm": "n1", "name": "Boys Hostel No. 2", "lat": 18.52, "lng": 73.85},
        {"osm": "n2", "name": "400 KV Chakan-Talegaon(PG)", "lat": 18.7, "lng": 73.8},
        {"osm": "n3", "name": "Zolo Sparkle", "lat": 18.59, "lng": 73.73, "locality": "Hinjawadi", "phone": "+91 99999 00000"},
        {"osm": "w3", "name": "Zolo Sparkle", "lat": 18.5901, "lng": 73.7301},
        {"osm": "n4", "name": "Simran ladies hostel", "lat": 18.6, "lng": 73.8, "internet_access": "wlan"},
    ]
    listings = {l.name: l for l in osm_listings(raw)}
    assert set(listings) == {"Zolo Sparkle", "Simran ladies hostel"}
    zolo = listings["Zolo Sparkle"]
    assert (zolo.stay_type, zolo.gender, zolo.area, zolo.contact_phone) == ("pg", None, "Hinjawadi", "+91 99999 00000")
    assert zolo.rooms == [] and not zolo.is_demo
    simran = listings["Simran ladies hostel"]
    assert (simran.stay_type, simran.gender, simran.amenities) == ("hostel", "girls", {"wifi": True})


def test_overture_stays_merge_with_osm_and_each_other() -> None:
    from app.seed import osm_listings, overture_listings

    osm = osm_listings([{"osm": "n1", "name": "Zolo Highrollers", "lat": 18.5900, "lng": 73.7300}])
    raw = [
        # the OSM stay again, under a longer name: fills in its phone instead of adding a copy
        {"id": "a1", "name": "Zolo Highrollers - PG in Hinjewadi Phase 1", "lat": 18.5901, "lng": 73.7301,
         "phone": "08880108010", "confidence": 0.85, "sources": ["meta"]},
        # the same Stanza house from two providers, 600 m apart
        {"id": "b1", "name": "Stanza Living Sidon House", "tagline": "Gents PG in Vadgaon", "lat": 18.46, "lng": 73.82,
         "phone": "08046007692", "confidence": 0.85, "sources": ["meta"]},
        {"id": "b2", "name": "Stanza Living Sidon House", "lat": 18.465, "lng": 73.82, "phone": "08046007460",
         "confidence": 0.6, "sources": ["Microsoft"]},
        # boys' and girls' blocks next door are different stays
        {"id": "c1", "name": "Metrocity Boys Hostel", "lat": 18.50, "lng": 73.80, "confidence": 0.8},
        {"id": "c2", "name": "Metrocity Girls Hostel", "lat": 18.5005, "lng": 73.80, "confidence": 0.8},
    ]
    new, enriched = overture_listings(raw, osm)
    assert enriched == 1 and osm[0].contact_phone == "08880108010"
    by_name = {l.name: l for l in new}
    assert sorted(by_name) == ["Metrocity Boys Hostel", "Metrocity Girls Hostel", "Stanza Living Sidon House"]
    sidon = by_name["Stanza Living Sidon House"]
    assert (sidon.stay_type, sidon.gender, sidon.data_source) == ("pg", "boys", "Overture Maps")
    assert "Meta" in sidon.description and "Gents PG in Vadgaon" in sidon.description
