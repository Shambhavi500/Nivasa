export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export const km = (d: number) => (d < 1 ? `${Math.max(10, Math.round(d * 100) * 10)} m` : `${d.toFixed(1)} km`)

export const walkMin = (d: number) => Math.max(1, Math.round((d / 4.8) * 60))

export function scoreBand(score: number | null): { label: string; tone: 'great' | 'good' | 'fair' | 'weak' | 'none' } {
  if (score == null) return { label: 'Not enough data', tone: 'none' }
  if (score >= 78) return { label: 'Great fit', tone: 'great' }
  if (score >= 62) return { label: 'Good fit', tone: 'good' }
  if (score >= 45) return { label: 'Fair fit', tone: 'fair' }
  return { label: 'Weak fit', tone: 'weak' }
}

export const toneColor: Record<ReturnType<typeof scoreBand>['tone'], string> = {
  great: 'var(--pin-great)',
  good: 'var(--pin-good)',
  fair: 'var(--pin-fair)',
  weak: 'var(--pin-weak)',
  none: 'var(--pin-weak)',
}

export const HIDDEN_REASON_LABELS: Record<string, string> = {
  budget: 'over budget',
  commute: 'too far',
  sharing: 'no matching room',
}

/** OpenStreetMap's router has foot, bike and car profiles; transit and autos are closest to car on the road. */
export function osmDirections(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode?: string | null): { url: string; label: string } {
  const [engine, label] = mode === 'walk' ? ['fossgis_osrm_foot', 'Walking route'] : mode === 'cycle' ? ['fossgis_osrm_bike', 'Cycling route'] : ['fossgis_osrm_car', 'Road route']
  return { url: `https://www.openstreetmap.org/directions?engine=${engine}&route=${from.lat}%2C${from.lng}%3B${to.lat}%2C${to.lng}`, label }
}

/** OSM stores several numbers in one tag, separated by ";" or ",". */
export const splitPhones = (s: string | null | undefined) => (s ? s.split(/[;,/]/).map((p) => p.trim()).filter(Boolean) : [])
export const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`
export const webHref = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`)
export const webLabel = (w: string) => w.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
