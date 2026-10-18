"""Turns a listing plus a student's preferences into an explainable match.

The Best-Fit score is a weighted average of six factor scores (0-100). A factor
whose inputs are unknown is left out of the average instead of being guessed,
and ``score_coverage`` reports how much of the student's weighting could be
assessed. Every number shown to the student is traceable to a reported fact,
OpenStreetMap data, or a documented estimate (see docs/METHODOLOGY.md).
"""

from __future__ import annotations

import math

from app import constants as C
from app.models import Listing, RoomOption
from app.schemas import (
    CommuteOut,
    CostBreakdown,
    CostLine,
    Essentials,
    Factor,
    FoodOption,
    ListingOut,
    MatchResult,
    ModeOptionOut,
    NearbyPlace,
    Preferences,
)
from app.services.commute import estimate_commute, fmt_km, recommend
from app.services.context import Context
from app.services.geo import Point

FOOD_RADIUS_KM = 1.5       # road distance a student will walk for meals
ESSENTIAL_RADIUS_KM = 1.5
WALK_KM = 0.8              # "within a 10-minute walk"
BUDGET_TOLERANCE = 1.15    # stays up to 15% over budget are shown, flagged


def rupees(n: int) -> str:
    s = str(abs(int(n)))
    if len(s) > 3:  # Indian digit grouping: 1,23,456
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "₹" + s


def _proximity(km: float) -> float:
    return 1.0 if km <= 0.3 else 0.8 if km <= 0.8 else 0.5 if km <= 1.2 else 0.3


def _food_fit(cuisines: tuple[str, ...] | list[str] | None, wanted: list[str], km: float) -> tuple[float, list[str], float | None]:
    prox = _proximity(km)
    if not wanted:
        return 100 * (0.5 + 0.5 * prox), [], None
    if cuisines is None:  # menu not known: proximity counts, but it cannot score well
        return 15 + 35 * prox, [], None
    matched = [w for w in wanted if w in cuisines]
    cov = len(matched) / len(wanted)
    return 100 * (0.6 * cov + 0.4 * prox), matched, cov


def food_options(listing: Listing, prefs: Preferences, ctx: Context) -> tuple[list[tuple[float, FoodOption]], list[str]]:
    notes: list[str] = []
    found: list[tuple[float, FoodOption]] = []
    here = Point(listing.lat, listing.lng)
    if listing.food_included:
        score, matched, cov = _food_fit(listing.kitchen_cuisines, prefs.cuisines, 0)
        found.append((score, FoodOption(kind="in_house", name="In-house kitchen", poi_id=None, lat=None, lng=None,
                                        distance_km=0, cuisines=listing.kitchen_cuisines, matched=matched, coverage=cov,
                                        pure_veg=listing.kitchen_pure_veg, jain=None, opening_hours=None)))
    idx = ctx.poi_index.get("mess")
    detour = ctx.settings.detour_factor
    if idx:
        for d, m in idx.within(here, FOOD_RADIUS_KM / detour):
            if prefs.diet == "jain" and m.jain is False:
                continue
            if prefs.diet == "veg" and prefs.pure_veg_only and m.pure_veg is False:
                continue
            km = d * detour
            score, matched, cov = _food_fit(m.cuisine, prefs.cuisines, km)
            found.append((score, FoodOption(kind="mess", name=m.name or "Unnamed mess", poi_id=m.id, lat=m.lat, lng=m.lng,
                                            distance_km=round(km, 2), cuisines=list(m.cuisine) if m.cuisine else None,
                                            matched=matched, coverage=cov, pure_veg=m.pure_veg, jain=m.jain,
                                            opening_hours=m.opening_hours)))
    found.sort(key=lambda x: -x[0])
    if found and prefs.diet == "jain" and found[0][1].jain is None:
        notes.append("Jain meals are not confirmed at the closest options")
    if found and prefs.pure_veg_only and found[0][1].pure_veg is None:
        notes.append("Pure-veg kitchen not confirmed at the best food option")
    return found, notes


def _nearest(ctx: Context, cat: str, here: Point, radius_km: float) -> NearbyPlace | None:
    idx = ctx.poi_index.get(cat)
    if not idx:
        return None
    hits = idx.within(here, radius_km / ctx.settings.detour_factor)
    if not hits:
        return None
    d, p = hits[0]
    return NearbyPlace(poi_id=p.id, name=p.name,distance_km=round(d * ctx.settings.detour_factor, 2), lat=p.lat, lng=p.lng)


def essentials(listing: Listing, ctx: Context) -> tuple[Essentials, int | None]:
    here = Point(listing.lat, listing.lng)
    by_cat: dict[str, NearbyPlace | None] = {}
    got = total = 0.0
    any_found = False
    for cat, w in C.ESSENTIAL_WEIGHTS.items():
        near = _nearest(ctx, cat, here, ESSENTIAL_RADIUS_KM)
        by_cat[cat] = near
        total += w
        if near:
            any_found = True
            km = near.distance_km
            got += w * (1.0 if km <= 0.4 else 0.75 if km <= WALK_KM else 0.4 if km <= 1.2 else 0.15)
    within = sum(1 for v in by_cat.values() if v and v.distance_km <= WALK_KM)
    score = round(100 * got / total) if any_found else None
    return Essentials(by_category=by_cat, within_walk=within, categories_total=len(C.ESSENTIAL_WEIGHTS)), score


def _pick_room(listing: Listing, sharing: str) -> tuple[RoomOption | None, bool]:
    """Return (room to price, sharing_unavailable)."""
    rooms = list(listing.rooms)
    if sharing == "any":
        priced = sorted((r for r in rooms if r.monthly_rent is not None), key=lambda r: r.monthly_rent or 0)
        return (priced[0] if priced else (rooms[0] if rooms else None)), False
    same = [r for r in rooms if r.sharing == sharing]
    if rooms and not same:
        return None, True
    priced = sorted((r for r in same if r.monthly_rent is not None), key=lambda r: r.monthly_rent or 0)
    return (priced[0] if priced else (same[0] if same else None)), False


def evaluate(listing: Listing, prefs: Preferences, dest: Point, dest_short: str, ctx: Context,
             road_km: float | None = None, routing_source: str = "estimate") -> MatchResult:
    s = ctx.settings
    hide: list[str] = []
    reasons: list[str] = []
    warnings: list[str] = []
    w = prefs.weights

    # ---- eligibility ----
    if listing.stay_type not in prefs.stay_types:
        hide.append("type")
    if listing.gender is None:
        warnings.append("Boys/girls policy not reported")
    elif listing.gender != "coed" and listing.gender != prefs.gender:
        hide.append("gender")
    room, sharing_missing = _pick_room(listing, prefs.sharing)
    if sharing_missing:
        hide.append("sharing")
    if not listing.rooms:
        warnings.append("Room types and rent not reported")

    # ---- commute ----
    est = estimate_commute(Point(listing.lat, listing.lng), dest, s, ctx.metro, road_km, routing_source)
    rec, within = recommend(est.options, prefs.modes, prefs.max_commute_min)
    if not within:
        hide.append("commute")
    opts_out = [ModeOptionOut(mode=o.mode, label=C.MODES[o.mode], available=o.available, in_preferences=o.mode in prefs.modes,
                              minutes=o.minutes, monthly_cost=o.monthly_cost, per_trip_cost=o.per_trip_cost, note=o.note)
                for o in est.options]
    rec_out = next((o for o in opts_out if rec and o.mode == rec.mode), None)

    # ---- food ----
    scored_food, food_notes = food_options(listing, prefs, ctx)
    warnings.extend(food_notes)

    # ---- money ----
    rent = room.monthly_rent if room else None
    rent_line = (CostLine(amount=rent, basis="reported", note=C.SHARING.get(room.sharing, room.sharing) if room else "")
                 if rent is not None else CostLine(amount=None, basis="unknown", note="Rent not reported"))
    if listing.food_included is True:
        food_line = CostLine(amount=0, basis="included", note=f"Included in rent ({listing.meals or 'meals'})")
    else:
        food_line = CostLine(amount=s.mess_monthly_estimate, basis="estimate",
                             note="Typical mess cost for 2 meals a day. Map data has no mess prices")
        if listing.food_included is None:
            warnings.append("Not reported whether meals are included")
    travel_line = (CostLine(amount=rec.monthly_cost, basis="estimate" if rec.monthly_cost else "not_needed",
                            note=f"{C.MODES[rec.mode]}, {s.college_days_per_month} college days, 2 trips a day")
                   if rec else CostLine(amount=None, basis="unknown", note="No travel option among your modes"))
    if listing.electricity_included is True:
        elec_line = CostLine(amount=0, basis="included", note="Included in rent")
    elif listing.electricity_included is False and listing.electricity_estimate is not None:
        elec_line = CostLine(amount=listing.electricity_estimate, basis="reported", note="Metered, owner's estimate for your share")
    elif listing.electricity_included is False:
        elec_line = CostLine(amount=None, basis="unknown", note="Metered separately, amount not reported")
    else:
        elec_line = CostLine(amount=None, basis="unknown", note="Not reported whether electricity is included")

    lines = {"rent": rent_line, "food": food_line, "travel": travel_line, "electricity": elec_line}
    unknown_parts = [k for k, v in lines.items() if v.amount is None]
    all_in = sum(v.amount or 0 for v in lines.values()) if rent is not None else None
    compared = all_in if prefs.budget_mode == "all_in" else rent
    difference = prefs.budget - compared if compared is not None else None
    budget_score: int | None = None
    if compared is not None:
        ratio = compared / prefs.budget
        if ratio > BUDGET_TOLERANCE:
            hide.append("budget")
        budget_score = round(min(100, max(0, 100 if ratio <= 0.75 else
                                          100 - (ratio - 0.75) / 0.25 * 45 if ratio <= 1 else
                                          55 - (ratio - 1) / (BUDGET_TOLERANCE - 1) * 40)))
        what = "all-in budget" if prefs.budget_mode == "all_in" else "rent budget"
        if difference is not None and difference >= 0:
            reasons.append(f"{rupees(difference)} under your {what}")
        elif difference is not None:
            warnings.append(f"{rupees(-difference)} over your {what}")
        if prefs.budget_mode == "all_in" and "electricity" in unknown_parts:
            warnings.append("Electricity cost unknown, so the all-in figure may be low")
    else:
        warnings.append("Rent not reported, so cost could not be checked")

    # ---- factor scores ----
    commute_score = (round(min(100, max(0, 100 - (rec.minutes - 8) / max(1, prefs.max_commute_min - 8) * 65)))
                     if rec and rec.minutes is not None else 0)
    if rec:
        verb = f"{rec.minutes}-minute walk" if rec.mode == "walk" else f"{rec.minutes} min by {C.MODES[rec.mode]}"
        reasons.append(f"{verb} to {dest_short}" + (f", {rupees(rec.monthly_cost)}/month" if rec.monthly_cost else ""))
    else:
        warnings.append("None of your travel modes reach your college")

    food_score: int | None = None
    food_detail = "No messes mapped near here in OpenStreetMap, so food could not be assessed"
    if scored_food:
        best_score, best = scored_food[0]
        food_score = round(best_score)
        where = "In-house kitchen" if best.kind == "in_house" else f"{best.name} ({fmt_km(best.distance_km)})"
        if prefs.cuisines and best.coverage == 1:
            reasons.append(f"{where} serves all {len(prefs.cuisines)} foods you picked")
            food_detail = f"{where} covers everything you picked"
        elif prefs.cuisines and best.coverage is not None:
            (reasons if best.coverage >= 0.5 else warnings).append(
                f"{where} covers {len(best.matched)} of {len(prefs.cuisines)} foods you picked")
            food_detail = f"{where} covers {len(best.matched)} of {len(prefs.cuisines)} foods you picked"
        elif prefs.cuisines:
            warnings.append(f"Menu not reported at {where}")
            food_detail = f"{where} is nearby but its menu is not reported"
        else:
            reasons.append(f"Food nearby: {where}")
            food_detail = f"{where}"

    amen = listing.amenities or {}
    must_missing = [k for k in prefs.must_haves if amen.get(k) is False]
    must_unknown = [k for k in prefs.must_haves if k not in amen]
    facilities_score: int | None = None
    if amen:
        have = sum(1 for v in amen.values() if v)
        facilities_score = round(min(100, max(0, 35 + 65 * have / len(C.AMENITIES) - 15 * len(must_missing) - 7 * len(must_unknown))))
        fac_detail = f"{have} facilities confirmed, {len(C.AMENITIES) - len(amen)} not reported"
    else:
        fac_detail = "No facilities reported"
    if must_missing:
        warnings.append("No " + ", ".join(C.AMENITIES[k] for k in must_missing))
    if must_unknown:
        warnings.append("Not confirmed: " + ", ".join(C.AMENITIES[k] for k in must_unknown))

    ess, market_score = essentials(listing, ctx)
    if market_score is not None:
        reasons.append(f"{ess.within_walk} of {ess.categories_total} daily essentials within a 10-minute walk")

    here = Point(listing.lat, listing.lng)
    police = _nearest(ctx, "police", here, 3.0)
    hospital = _nearest(ctx, "hospital", here, 3.0)
    safe = listing.safety or {}
    safety_score: int | None = None
    if safe:
        yes = sum(1 for v in safe.values() if v)
        safety_score = round(85 * yes / len(safe) + (15 if police and police.distance_km <= 2 else 0))
        safety_detail = f"{yes} of {len(safe)} reported safety features present"
    else:
        safety_detail = "No safety features reported"

    if listing.is_demo:
        warnings.insert(0, "Demo listing: not a real property")
    elif listing.verification_status != "visit_verified":
        warnings.append("Not yet verified by a site visit")
    if listing.available_beds == 0:
        warnings.append("Full right now")

    factors = [
        Factor(key="budget", label=C.FACTORS["budget"], weight=w.budget, score=budget_score,
               detail=("Rent not reported" if budget_score is None else
                       f"{rupees(compared or 0)} against your {rupees(prefs.budget)} budget")),
        Factor(key="commute", label=C.FACTORS["commute"], weight=w.commute, score=commute_score,
               detail=(f"{rec.minutes} min by {C.MODES[rec.mode]} (estimate)" if rec else "No usable travel mode")),
        Factor(key="food", label=C.FACTORS["food"], weight=w.food, score=food_score, detail=food_detail),
        Factor(key="facilities", label=C.FACTORS["facilities"], weight=w.facilities, score=facilities_score, detail=fac_detail),
        Factor(key="market", label=C.FACTORS["market"], weight=w.market, score=market_score,
               detail=("No shops mapped near here in OpenStreetMap" if market_score is None else
                       f"{ess.within_walk} of {ess.categories_total} essentials within 800 m (OpenStreetMap)")),
        Factor(key="safety", label=C.FACTORS["safety"], weight=w.safety, score=safety_score, detail=safety_detail),
    ]
    total_w = sum(f.weight for f in factors)
    known = [f for f in factors if f.score is not None and f.weight > 0]
    known_w = sum(f.weight for f in known)
    assessed = sum(f.weight * (f.score or 0) for f in known) / known_w if known_w else None
    coverage = round(known_w / total_w, 2) if total_w else 0.0
    # Missing details are never filled in, but they do cost confidence: a stay that hides what the
    # student cares about most must not outrank one that reports it. Full data keeps the assessed
    # score; with half the weighting unreported the score is multiplied by 0.75.
    score = round(assessed * (0.5 + 0.5 * coverage)) if assessed is not None else None

    return MatchResult(
        listing=ListingOut.model_validate(listing),
        score=score,
        assessed_score=round(assessed) if assessed is not None else None,
        score_coverage=coverage,
        factors=factors,
        cost=CostBreakdown(rent=rent_line, sharing=room.sharing if room else None, food=food_line, travel=travel_line,
                           electricity=elec_line, all_in_known=all_in, unknown_parts=unknown_parts, budget=prefs.budget,
                           budget_mode=prefs.budget_mode, compared_amount=compared, difference=difference),
        commute=CommuteOut(distance_km=est.distance_km, straight_km=est.straight_km, routing_source=est.routing_source,
                           recommended=rec_out, within_limit=within, options=opts_out),
        food=[f for _, f in scored_food[:6]],
        essentials=ess,
        nearest_police=police,
        nearest_hospital=hospital,
        reasons=reasons,
        warnings=warnings,
        hidden_reasons=hide,
    )


def budget_needed(compared: int) -> int:
    """Smallest round budget (₹500 steps) at which an amount is no longer hidden."""
    return int(math.ceil(compared / BUDGET_TOLERANCE / 500) * 500)
