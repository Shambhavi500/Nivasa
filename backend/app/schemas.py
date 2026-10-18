"""Request and response models for the public API."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.geo import in_region

StayType = Literal["hostel", "pg", "flat"]
Gender = Literal["boys", "girls", "coed"]
Sharing = Literal["single", "double", "triple", "quad"]
Mode = Literal["walk", "cycle", "two_wheeler", "metro", "bus", "auto"]
Diet = Literal["veg", "nonveg", "jain"]
FactorKey = Literal["budget", "commute", "food", "facilities", "market", "safety"]

AMENITY_KEYS: tuple[str, ...] = ("wifi", "ac", "attached_bathroom", "laundry", "power_backup", "hot_water",
                                 "study_table", "housekeeping", "cctv", "gym", "ro_water", "two_wheeler_parking")
AmenityKey = Literal["wifi", "ac", "attached_bathroom", "laundry", "power_backup", "hot_water",
                     "study_table", "housekeeping", "cctv", "gym", "ro_water", "two_wheeler_parking"]
SAFETY_KEYS: tuple[str, ...] = ("cctv", "security_guard", "warden", "lit_access_road")
CUISINES: tuple[str, ...] = ("Maharashtrian", "North Indian", "South Indian", "Gujarati", "Jain", "Bengali",
                             "Chinese", "Non-veg", "Breakfast")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- preferences (search input) ----------

class Destination(Strict):
    college_id: str | None = Field(default=None, max_length=64)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    label: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _one_kind(self) -> Destination:
        has_point = self.lat is not None and self.lng is not None
        if not self.college_id and not has_point:
            raise ValueError("Choose a college or a point on the map.")
        if (self.lat is None) != (self.lng is None):
            raise ValueError("A map point needs both latitude and longitude.")
        if has_point and not in_region(self.lat, self.lng):  # type: ignore[arg-type]
            raise ValueError("That point is outside the Pune region Nivasa covers.")
        return self


class Weights(Strict):
    budget: int = Field(default=4, ge=0, le=5)
    commute: int = Field(default=4, ge=0, le=5)
    food: int = Field(default=3, ge=0, le=5)
    facilities: int = Field(default=3, ge=0, le=5)
    market: int = Field(default=2, ge=0, le=5)
    safety: int = Field(default=3, ge=0, le=5)

    @model_validator(mode="after")
    def _not_all_zero(self) -> Weights:
        if not any(self.model_dump().values()):
            raise ValueError("At least one priority must be above zero.")
        return self


class Preferences(Strict):
    destination: Destination
    budget: int = Field(ge=3000, le=60000, description="Monthly amount in rupees")
    budget_mode: Literal["all_in", "rent"] = "all_in"
    gender: Literal["boys", "girls"]
    stay_types: list[StayType] = Field(default_factory=lambda: ["hostel", "pg", "flat"], min_length=1)
    sharing: Literal["any", "single", "double", "triple"] = "any"
    modes: list[Mode] = Field(default_factory=lambda: ["walk", "metro", "bus"], min_length=1)
    max_commute_min: int = Field(default=30, ge=5, le=90)
    diet: Diet = "veg"
    pure_veg_only: bool = False
    cuisines: list[str] = Field(default_factory=list, max_length=len(CUISINES))
    must_haves: list[AmenityKey] = Field(default_factory=list)
    weights: Weights = Field(default_factory=Weights)

    @field_validator("stay_types", "modes", "must_haves", "cuisines")
    @classmethod
    def _dedupe(cls, v: list) -> list:
        return list(dict.fromkeys(v))

    @field_validator("cuisines")
    @classmethod
    def _known_cuisines(cls, v: list[str]) -> list[str]:
        unknown = [c for c in v if c not in CUISINES]
        if unknown:
            raise ValueError(f"Unknown cuisine: {', '.join(unknown)}")
        return v


# ---------- reference data ----------

class CollegeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    short_name: str
    area: str
    lat: float
    lng: float
    osm_ref: str | None


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sharing: Sharing
    monthly_rent: int | None


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    stay_type: StayType
    gender: Gender | None
    area: str
    address: str | None
    lat: float
    lng: float
    location_precision: str
    description: str | None
    rooms: list[RoomOut]
    food_included: bool | None
    meals: str | None
    kitchen_cuisines: list[str] | None
    kitchen_pure_veg: bool | None
    electricity_included: bool | None
    electricity_estimate: int | None
    deposit: int | None
    notice_period: str | None
    lock_in: str | None
    curfew: str | None
    guest_policy: str | None
    available_beds: int | None
    amenities: dict[str, bool]
    safety: dict[str, bool]
    contact_name: str | None
    contact_phone: str | None
    contact_email: str | None
    contact_website: str | None = None
    is_demo: bool
    verification_status: str
    verified_on: date | None
    data_source: str


class PoiOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    category: str
    name: str | None
    lat: float
    lng: float
    cuisine: list[str] | None = None
    pure_veg: bool | None = None
    jain: bool | None = None
    opening_hours: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = None
    details: dict[str, str] | None = None
    contact_source: str | None = None


class StationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    lat: float
    lng: float
    status: str


class LineStopOut(BaseModel):
    name: str
    lat: float
    lng: float


class LineOut(BaseModel):
    id: str
    name: str
    colour: str | None
    stops: list[LineStopOut]


class TransitOut(BaseModel):
    lines: list[LineOut]
    stations: list[StationOut]
    source: str


# ---------- match results ----------

class Factor(BaseModel):
    key: FactorKey
    label: str
    weight: int
    score: int | None
    detail: str


class CostLine(BaseModel):
    amount: int | None
    basis: Literal["reported", "included", "estimate", "unknown", "not_needed"]
    note: str


class CostBreakdown(BaseModel):
    rent: CostLine
    sharing: Sharing | None
    food: CostLine
    travel: CostLine
    electricity: CostLine
    all_in_known: int | None
    unknown_parts: list[str]
    budget: int
    budget_mode: Literal["all_in", "rent"]
    compared_amount: int | None
    difference: int | None  # budget minus compared amount; negative means over budget


class ModeOptionOut(BaseModel):
    mode: Mode
    label: str
    available: bool
    in_preferences: bool
    minutes: int | None
    monthly_cost: int | None
    per_trip_cost: int | None
    note: str


class CommuteOut(BaseModel):
    distance_km: float
    straight_km: float
    routing_source: str
    recommended: ModeOptionOut | None
    within_limit: bool
    options: list[ModeOptionOut]


class FoodOption(BaseModel):
    kind: Literal["in_house", "mess"]
    name: str
    poi_id: str | None
    lat: float | None
    lng: float | None
    distance_km: float
    cuisines: list[str] | None
    matched: list[str]
    coverage: float | None
    pure_veg: bool | None
    jain: bool | None
    opening_hours: str | None


class NearbyPlace(BaseModel):
    poi_id: str | None = None
    name: str | None
    distance_km: float
    lat: float
    lng: float


class Essentials(BaseModel):
    by_category: dict[str, NearbyPlace | None]
    within_walk: int
    categories_total: int


class MatchResult(BaseModel):
    listing: ListingOut
    score: int | None
    assessed_score: int | None  # average of the factors that could be assessed
    score_coverage: float       # share of the student's weighting that could be assessed
    factors: list[Factor]
    cost: CostBreakdown
    commute: CommuteOut
    food: list[FoodOption]
    essentials: Essentials
    nearest_police: NearbyPlace | None
    nearest_hospital: NearbyPlace | None
    reasons: list[str]
    warnings: list[str]
    hidden_reasons: list[str]


class HiddenListing(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    reasons: list[str]


class ResolvedDestination(BaseModel):
    label: str
    short_label: str
    lat: float
    lng: float
    college_id: str | None


class BudgetSuggestion(BaseModel):
    budget: int
    extra_results: int


class SearchResponse(BaseModel):
    destination: ResolvedDestination
    results: list[MatchResult]
    hidden: list[HiddenListing]
    hidden_counts: dict[str, int]
    budget_suggestion: BudgetSuggestion | None
    total_considered: int
    includes_demo: bool
    data_notice: str


# ---------- writes ----------

class ReportIn(Strict):
    topic: Literal["rent", "availability", "facilities", "location", "contact", "closed", "other"]
    message: str = Field(min_length=5, max_length=1000)


class RoomIn(Strict):
    sharing: Sharing
    monthly_rent: int | None = Field(default=None, ge=1000, le=100000)


class SubmissionIn(Strict):
    """A listing suggested by an owner or a student. It stays hidden until an admin approves it."""
    name: str = Field(min_length=3, max_length=200)
    stay_type: StayType
    gender: Gender | None = None
    area: str = Field(min_length=2, max_length=120)
    address: str | None = Field(default=None, max_length=300)
    lat: float
    lng: float
    rooms: list[RoomIn] = Field(default_factory=list, max_length=4)
    food_included: bool | None = None
    amenities: dict[AmenityKey, bool] = Field(default_factory=dict)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, pattern=r"^\+?[0-9 \-]{8,16}$")
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _in_region(self) -> SubmissionIn:
        if not in_region(self.lat, self.lng):
            raise ValueError("The location must be inside the Pune region.")
        return self


class GeocodeResult(BaseModel):
    label: str
    short_label: str
    lat: float
    lng: float
    source: str


class MetaOut(BaseModel):
    stay_types: dict[str, str]
    genders: dict[str, str]
    sharing: dict[str, str]
    modes: dict[str, str]
    diets: dict[str, str]
    cuisines: list[str]
    amenities: dict[str, str]
    safety: dict[str, str]
    essentials: dict[str, str]
    factors: dict[str, str]
    default_weights: Weights
    region_bounds: tuple[float, float, float, float]
    datasets: list[dict]
    geocoder_enabled: bool
    routing_provider: str
