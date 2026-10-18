"""Database models.

Unknown facts are stored as NULL (or a missing key in the JSON fact maps) and are
never replaced by guesses. ``amenities`` and ``safety`` are tri-state maps:
``{"wifi": true, "ac": false}`` means Wi-Fi confirmed, AC confirmed absent, and
every other amenity not reported.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class College(Base):
    __tablename__ = "colleges"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    short_name: Mapped[str] = mapped_column(String(80))
    area: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    osm_ref: Mapped[str | None] = mapped_column(String(32))


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (Index("ix_listings_lat_lng", "lat", "lng"), Index("ix_listings_status", "status"))

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    stay_type: Mapped[str] = mapped_column(String(16))  # hostel | pg | flat
    gender: Mapped[str | None] = mapped_column(String(8))  # boys | girls | coed | NULL (not reported)
    area: Mapped[str] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(300))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    location_precision: Mapped[str] = mapped_column(String(16), default="approximate")  # exact | approximate
    description: Mapped[str | None] = mapped_column(Text)

    food_included: Mapped[bool | None] = mapped_column(Boolean)
    meals: Mapped[str | None] = mapped_column(String(80))
    kitchen_cuisines: Mapped[list[str] | None] = mapped_column(JSON)
    kitchen_pure_veg: Mapped[bool | None] = mapped_column(Boolean)

    electricity_included: Mapped[bool | None] = mapped_column(Boolean)
    electricity_estimate: Mapped[int | None] = mapped_column(Integer)
    deposit: Mapped[int | None] = mapped_column(Integer)
    notice_period: Mapped[str | None] = mapped_column(String(40))
    lock_in: Mapped[str | None] = mapped_column(String(40))
    curfew: Mapped[str | None] = mapped_column(String(40))
    guest_policy: Mapped[str | None] = mapped_column(String(120))
    available_beds: Mapped[int | None] = mapped_column(Integer)

    amenities: Mapped[dict[str, bool]] = mapped_column(JSON, default=dict)
    safety: Mapped[dict[str, bool]] = mapped_column(JSON, default=dict)

    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    contact_email: Mapped[str | None] = mapped_column(String(200))
    contact_website: Mapped[str | None] = mapped_column(String(300))

    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | pending | rejected
    verification_status: Mapped[str] = mapped_column(String(24), default="unverified")  # unverified | owner_submitted | visit_verified
    verified_on: Mapped[date | None] = mapped_column(Date)
    data_source: Mapped[str] = mapped_column(String(120), default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    rooms: Mapped[list[RoomOption]] = relationship(back_populates="listing", cascade="all, delete-orphan",
                                                   order_by="RoomOption.id", lazy="selectin")


class RoomOption(Base):
    __tablename__ = "room_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    listing_id: Mapped[str] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    sharing: Mapped[str] = mapped_column(String(8))  # single | double | triple | quad
    monthly_rent: Mapped[int | None] = mapped_column(Integer)  # NULL = rent on request / not reported

    listing: Mapped[Listing] = relationship(back_populates="rooms")


class Poi(Base):
    """A real place from OpenStreetMap: shop, pharmacy, mess, police station, ..."""

    __tablename__ = "pois"
    __table_args__ = (Index("ix_pois_cat_lat_lng", "category", "lat", "lng"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # OSM ref, e.g. n123 / w456
    category: Mapped[str] = mapped_column(String(24))
    name: Mapped[str | None] = mapped_column(String(200))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    cuisine: Mapped[list[str] | None] = mapped_column(JSON)
    pure_veg: Mapped[bool | None] = mapped_column(Boolean)
    jain: Mapped[bool | None] = mapped_column(Boolean)
    opening_hours: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(String(300))
    address: Mapped[str | None] = mapped_column(String(300))
    # Extra mapped facts (speciality, emergency, operator, emergency_phone, ...); missing keys are unknown.
    details: Mapped[dict[str, str] | None] = mapped_column(JSON)
    contact_source: Mapped[str | None] = mapped_column(String(300))


class MetroStation(Base):
    """Every Pune Metro station in the OSM snapshot, open or under construction (map display)."""

    __tablename__ = "metro_stations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16))  # open | construction


class MetroLine(Base):
    """An operational line with its ordered stops (used for commute routing)."""

    __tablename__ = "metro_lines"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    colour: Mapped[str | None] = mapped_column(String(24))
    osm_ref: Mapped[str | None] = mapped_column(String(32))
    stops: Mapped[list[MetroStop]] = relationship(order_by="MetroStop.seq", cascade="all, delete-orphan", lazy="selectin")


class MetroStop(Base):
    __tablename__ = "metro_stops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    line_id: Mapped[str] = mapped_column(ForeignKey("metro_lines.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)


class ListingReport(Base):
    """A student's note that something on a listing is wrong or outdated."""

    __tablename__ = "listing_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    listing_id: Mapped[str] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    topic: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DataSnapshot(Base):
    """Where each seeded dataset came from and when, so the UI can attribute it."""

    __tablename__ = "data_snapshots"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    source: Mapped[str] = mapped_column(String(300))
    fetched_at: Mapped[str | None] = mapped_column(String(40))
    record_count: Mapped[int] = mapped_column(Integer, default=0)
