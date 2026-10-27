from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import College, Listing
from app.schemas import BudgetSuggestion, Destination, HiddenListing, Preferences, ResolvedDestination, SearchResponse
from app.services.context import Context
from app.services.geo import Point
from app.services.matching import budget_needed, evaluate
from app.services.routing import road_distances

DATA_NOTICE = ("Commute times and costs are estimates. Shops, messes, colleges and metro data come from "
               "OpenStreetMap and may be incomplete. Stays from OpenStreetMap and Overture Maps have no rent or room details.")


def resolve_destination(db: Session, d: Destination) -> ResolvedDestination:
    if d.college_id:
        c = db.get(College, d.college_id)
        if c is None:
            raise HTTPException(status_code=422, detail=f"Unknown college '{d.college_id}'.")
        return ResolvedDestination(label=c.name, short_label=c.short_name, lat=c.lat, lng=c.lng, college_id=c.id)
    label = (d.label or "Your pinned location").strip()
    return ResolvedDestination(label=label, short_label=label if len(label) <= 28 else "your destination",
                               lat=d.lat, lng=d.lng, college_id=None)  # type: ignore[arg-type]


def active_listings(db: Session, include_demo: bool) -> list[Listing]:
    q = select(Listing).where(Listing.status == "active")
    if not include_demo:
        q = q.where(Listing.is_demo.is_(False))
    return list(db.scalars(q.order_by(Listing.id)))


def run_search(db: Session, prefs: Preferences, ctx: Context) -> SearchResponse:
    dest = resolve_destination(db, prefs.destination)
    target = Point(dest.lat, dest.lng)
    listings = active_listings(db, ctx.settings.include_demo_listings)
    roads, source = road_distances([Point(l.lat, l.lng) for l in listings], target, ctx.settings)
    evals = [evaluate(l, prefs, target, dest.short_label, ctx, roads[i] if roads else None, source)
             for i, l in enumerate(listings)]

    visible = [e for e in evals if not e.hidden_reasons]
    visible.sort(key=lambda e: (e.score is None, -(e.score or 0), e.cost.compared_amount or 10**9))
    relevant = [e for e in evals if e.hidden_reasons and not {"type", "gender"} & set(e.hidden_reasons)]
    counts: dict[str, int] = {}
    for e in relevant:
        for r in e.hidden_reasons:
            counts[r] = counts.get(r, 0) + 1
    hidden = [HiddenListing(id=e.listing.id, name=e.listing.name, lat=e.listing.lat, lng=e.listing.lng,
                            reasons=e.hidden_reasons) for e in relevant]

    suggestion = None
    only_budget = sorted(e.cost.compared_amount for e in relevant
                         if e.hidden_reasons == ["budget"] and e.cost.compared_amount is not None)
    if only_budget:
        k = min(3, len(only_budget))
        need = budget_needed(only_budget[k - 1])
        if need <= 60000:
            suggestion = BudgetSuggestion(budget=need, extra_results=k)

    return SearchResponse(destination=dest, results=visible, hidden=hidden, hidden_counts=counts,
                          budget_suggestion=suggestion, total_considered=len(listings),
                          includes_demo=any(l.is_demo for l in listings), data_notice=DATA_NOTICE)
