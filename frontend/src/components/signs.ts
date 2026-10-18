import L from 'leaflet'
import { scoreBand, toneColor } from '../lib/format'
import type { MatchResult, StayType, Transit } from '../lib/types'
import { glyph, type GlyphName } from './glyphs'

/**
 * One sign per kind of place, shared by the map markers, the map legend and the page sections, so a
 * mess, a pharmacy or a metro stop looks the same everywhere it appears.
 */
export interface Sign {
  glyph: GlyphName
  label: string
  bg: string
  fg: string
}

const white = '#ffffff'
const shop = (g: GlyphName, label: string): Sign => ({ glyph: g, label, bg: 'var(--sign-shop)', fg: white })

export const SIGNS = {
  hostel: { glyph: 'hostel', label: 'Hostel', bg: 'var(--primary)', fg: 'var(--on-primary)' },
  pg: { glyph: 'pg', label: 'PG', bg: 'var(--primary)', fg: 'var(--on-primary)' },
  flat: { glyph: 'flat', label: 'Shared flat', bg: 'var(--primary)', fg: 'var(--on-primary)' },
  mess: { glyph: 'mess', label: 'Mess', bg: 'var(--sign-mess)', fg: white },
  grocery: shop('grocery', 'Grocery'),
  vegetables: shop('vegetables', 'Vegetables & fruit'),
  stationery: shop('stationery', 'Xerox & stationery'),
  laundry: shop('laundry', 'Laundry'),
  atm: shop('atm', 'ATM or bank'),
  gym: shop('gym', 'Gym'),
  library: shop('library', 'Library'),
  pharmacy: { glyph: 'pharmacy', label: 'Pharmacy', bg: 'var(--sign-health)', fg: white },
  hospital: { glyph: 'hospital', label: 'Hospital or clinic', bg: 'var(--sign-health)', fg: white },
  police: { glyph: 'police', label: 'Police', bg: 'var(--sign-police)', fg: white },
  metro: { glyph: 'metro', label: 'Metro station', bg: 'var(--metro-purple)', fg: white },
  college: { glyph: 'college', label: 'Your destination', bg: 'var(--ink)', fg: 'var(--on-ink)' },
  walk: { glyph: 'walk', label: 'Walk', bg: 'var(--surface-3)', fg: 'var(--ink)' },
  cycle: { glyph: 'cycle', label: 'Cycle', bg: 'var(--surface-3)', fg: 'var(--ink)' },
  two_wheeler: { glyph: 'two_wheeler', label: 'Two-wheeler', bg: 'var(--surface-3)', fg: 'var(--ink)' },
  bus: { glyph: 'bus', label: 'PMPML bus', bg: 'var(--surface-3)', fg: 'var(--ink)' },
  auto: { glyph: 'auto', label: 'Auto-rickshaw', bg: 'var(--surface-3)', fg: 'var(--ink)' },
} satisfies Record<string, Sign>

export type SignKey = keyof typeof SIGNS

export function signFor(key: string): Sign {
  return (SIGNS as Record<string, Sign>)[key] ?? shop('grocery', key)
}

/** Everyday places a student looks for around a stay (the POI categories the API serves). */
export const ESSENTIAL_KEYS = ['grocery', 'vegetables', 'pharmacy', 'stationery', 'laundry', 'atm', 'gym', 'library'] as const
export const SAFETY_KEYS = ['police', 'hospital'] as const

const cache = new Map<string, L.DivIcon>()
function cached(key: string, make: () => L.DivIcon): L.DivIcon {
  let icon = cache.get(key)
  if (!icon) { icon = make(); cache.set(key, icon) }
  return icon
}

/** A stay: a pill with the stay-type glyph and the Best-Fit score, pointing at the building. */
export function stayIcon(type: StayType, score: number | null, selected = false): L.DivIcon {
  return cached(`stay-${type}-${score}-${selected}`, () => L.divIcon({
    className: '',
    html: `<div class="nv-stay${selected ? ' is-selected' : ''}" style="--band:${toneColor[scoreBand(score).tone]}">${glyph(SIGNS[type].glyph, 14)}<span>${score ?? '?'}</span></div>`,
    iconSize: [56, 28],
    iconAnchor: [28, 35],
    tooltipAnchor: [0, -36],
  }))
}

/** A round category sign (mess, shop, pharmacy, police...). */
export function placeIcon(key: string, size = 24, best = false): L.DivIcon {
  return cached(`place-${key}-${size}-${best}`, () => {
    const s = signFor(key)
    return L.divIcon({
      className: '',
      html: `<div class="nv-sign${best ? ' is-best' : ''}" style="--sign-bg:${s.bg};--sign-fg:${s.fg}">${glyph(s.glyph, Math.round(size * 0.55))}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2],
    })
  })
}

export function metroIcon(colour: string | null, planned: boolean): L.DivIcon {
  const c = colour === 'purple' ? 'var(--metro-purple)' : colour === 'aqua' ? 'var(--metro-aqua)' : 'var(--muted)'
  return cached(`metro-${colour}-${planned}`, () => L.divIcon({
    className: '',
    html: `<div class="nv-metro${planned ? ' is-planned' : ''}" style="--line-colour:${c}">${glyph('metro', 11)}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    tooltipAnchor: [0, -10],
  }))
}

export const destIcon = L.divIcon({
  className: '', html: `<div class="nv-dest">${glyph('college', 18)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17], tooltipAnchor: [0, 17],
})

/** A plain dropped pin, for "tap the map" pickers. */
export const dropPinIcon = L.divIcon({ className: '', html: '<div class="nv-dest-pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] })

export function signHtml(key: string, size = 16): string {
  return glyph(signFor(key).glyph, size)
}

/** Which line each station is on, from the line stop lists (stations themselves carry no colour). */
export function stationColours(transit: Transit | null): Map<string, string | null> {
  const m = new Map<string, string | null>()
  transit?.lines.forEach((l) => l.stops.forEach((s) => { if (!m.has(s.name)) m.set(s.name, l.colour) }))
  return m
}

export interface NearbyPoint {
  key: string
  poi_id?: string | null
  sign: string
  name: string | null
  lat: number
  lng: number
  distance_km: number
  best?: boolean
}

/** Every mapped place the match result names around a stay: its best kitchen, daily essentials, police and hospital. */
export function nearbyPoints(r: MatchResult): NearbyPoint[] {
  const pts: NearbyPoint[] = []
  const mess = r.food.find((f) => f.kind === 'mess' && f.lat != null && f.lng != null)
  if (mess) pts.push({ key: 'mess', poi_id: mess.poi_id, sign: 'mess', name: mess.name, lat: mess.lat!, lng: mess.lng!, distance_km: mess.distance_km, best: true })
  r.food.filter((f) => f !== mess && f.kind === 'mess' && f.lat != null && f.lng != null).slice(0, 4)
    .forEach((f, i) => pts.push({ key: `mess-${i}`, poi_id: f.poi_id, sign: 'mess', name: f.name, lat: f.lat!, lng: f.lng!, distance_km: f.distance_km }))
  Object.entries(r.essentials.by_category).forEach(([cat, p]) => {
    if (p) pts.push({ key: cat, poi_id: p.poi_id, sign: cat, name: p.name, lat: p.lat, lng: p.lng, distance_km: p.distance_km })
  })
  if (r.nearest_police) pts.push({ key: 'police', sign: 'police', ...r.nearest_police })
  if (r.nearest_hospital) pts.push({ key: 'hospital', sign: 'hospital', ...r.nearest_hospital })
  return pts
}
