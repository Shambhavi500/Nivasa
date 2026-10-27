import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import { api } from '../lib/api'
import { openPlace } from '../lib/placeSheet'
import { HIDDEN_REASON_LABELS, inr, toneColor } from '../lib/format'
import type { HiddenListing, MatchResult, Poi, ResolvedDestination, Transit } from '../lib/types'
import { useTransit } from '../lib/useReference'
import { TILE_ATTRIBUTION, TILE_URL } from './mapConfig'
import { destIcon, ESSENTIAL_KEYS, metroIcon, placeIcon, SAFETY_KEYS, signFor, stationColours, stayDotIcon, stayIcon } from './signs'
import { Glyph } from './ui'

// Colours are applied through CSS classes (see index.css) so they follow the light/dark theme.
const lineClass = (c: string | null) => (c === 'purple' || c === 'aqua' ? `nv-line-${c}` : 'nv-line-other')

function FitTo({ dest, results, fitKey }: { dest: ResolvedDestination; results: MatchResult[]; fitKey: string }) {
  const map = useMap()
  const [shown, setShown] = useState(0)
  // On phones the map can mount inside a hidden tab with zero size. Re-measure whenever the
  // container changes size, and fit again the first time it becomes visible.
  useEffect(() => {
    const el = map.getContainer()
    let wasHidden = el.clientWidth === 0
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
      const hidden = el.clientWidth === 0
      if (wasHidden && !hidden) setShown((n) => n + 1)
      wasHidden = hidden
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  useEffect(() => {
    if (map.getContainer().clientWidth === 0) return
    const pts: [number, number][] = [[dest.lat, dest.lng], ...results.slice(0, 15).map((r) => [r.listing.lat, r.listing.lng] as [number, number])]
    if (pts.length === 1) map.setView(pts[0], 14)
    else map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 15 })
    // Re-fit only when the search changes or the map first becomes visible, not on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, shown])
  return null
}

function PanTo({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target && !map.getBounds().pad(-0.1).contains(target)) map.panTo(target)
  }, [map, target])
  return null
}

export function PoiLayer({ categories, enabled, minZoom = 14 }: { categories: string[]; enabled: boolean; minZoom?: number }) {
  const [pois, setPois] = useState<Poi[]>([])
  const [zoomedOut, setZoomedOut] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const map = useMap()
  const load = () => {
    if (!enabled || !categories.length) { setPois([]); setZoomedOut(false); return }
    if (map.getZoom() < minZoom) { setZoomedOut(true); setPois([]); return }
    setZoomedOut(false)
    const b = map.getBounds()
    abort.current?.abort()
    abort.current = new AbortController()
    api.pois({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, categories, abort.current.signal)
      .then(setPois)
      .catch(() => { /* leave the previous places on screen */ })
  }
  useMapEvents({ moveend: load })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [enabled, categories.join(',')])
  useEffect(() => () => abort.current?.abort(), [])
  if (!enabled) return null
  return (
    <>
      {zoomedOut && <ZoomHint zoom={minZoom} />}
      {pois.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={placeIcon(p.category, p.category === 'mess' ? 24 : 22)} zIndexOffset={-500}
          title={`${signFor(p.category).label}${p.name ? `: ${p.name}` : ''}. Click for details`} eventHandlers={{ click: () => openPlace(p) }}>
          <Tooltip direction="top">{signFor(p.category).label}{p.name ? `: ${p.name}` : ''}{p.phone ? ' · has phone' : ''}<br /><span className="opacity-75">Click for details</span></Tooltip>
        </Marker>
      ))}
    </>
  )
}

function ZoomHint({ zoom }: { zoom: number }) {
  const map = useMap()
  const ref = useRef<HTMLDivElement>(null)
  // Keep clicks and scrolls on the hint from reaching the map underneath.
  useEffect(() => {
    if (!ref.current) return
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
  }, [])
  return (
    <div ref={ref} className="absolute bottom-28 left-1/2 z-[1000] -translate-x-1/2 sm:bottom-auto sm:top-3">
      <button type="button" className="btn btn-sm whitespace-nowrap bg-surface shadow-md" onClick={() => map.setZoom(zoom)}>
        Zoom in to see messes and shops
      </button>
    </div>
  )
}

// The best stays always get a score pin. The rest are dots until the map is zoomed in far enough to
// tell neighbouring pins apart, so 150 results near a central college don't pile up.
const PINNED = 40
const ALL_PINS_ZOOM = 15

function useZoom(): number {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return zoom
}

function StayMarkers({ ordered, selectedId, onSelect }: { ordered: MatchResult[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const zoom = useZoom()
  return ordered.map((r, i) => {
    const isSelected = r.listing.id === selectedId
    const pin = isSelected || zoom >= ALL_PINS_ZOOM || i >= ordered.length - PINNED
    return (
      <Marker key={r.listing.id} position={[r.listing.lat, r.listing.lng]}
        icon={pin ? stayIcon(r.listing.stay_type, r.score, isSelected) : stayDotIcon(r.score)}
        zIndexOffset={isSelected ? 1000 : pin ? 0 : -100} title={`${r.listing.name}, score ${r.score ?? 'n/a'}`}
        eventHandlers={{ click: () => onSelect(r.listing.id) }}>
        <Tooltip direction="top">
          <b className="text-inherit">{r.listing.name}</b>{r.listing.is_demo ? ' (demo)' : ''}<br />
          {r.cost.all_in_known != null ? `${inr(r.cost.all_in_known)} all-in` : 'Rent not reported'}
          {r.commute.recommended ? ` · ${r.commute.recommended.minutes} min` : ''}
        </Tooltip>
      </Marker>
    )
  })
}

type LayerKey = 'metro' | 'messes' | 'essentials' | 'safety' | 'hidden'
const LAYERS: [LayerKey, string, string][] = [
  ['metro', 'Metro', 'metro'], ['messes', 'Messes', 'mess'], ['essentials', 'Daily needs', 'grocery'],
  ['safety', 'Police & health', 'hospital'], ['hidden', 'Hidden stays', ''],
]

interface Props {
  destination: ResolvedDestination
  results: MatchResult[]
  hidden: HiddenListing[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  fitKey: string
}

export function ResultsMap({ destination, results, hidden, selectedId, onSelect, fitKey }: Props) {
  const transit: Transit | null = useTransit()
  const colours = useMemo(() => stationColours(transit), [transit])
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ metro: true, messes: true, essentials: false, safety: false, hidden: true })
  const selected = results.find((r) => r.listing.id === selectedId) ?? null
  const bestMess = selected?.food.find((f) => f.kind === 'mess' && f.lat != null) ?? null
  const poiCats = useMemo(() => [
    ...(layers.messes ? ['mess'] : []), ...(layers.essentials ? ESSENTIAL_KEYS : []), ...(layers.safety ? SAFETY_KEYS : []),
  ], [layers.messes, layers.essentials, layers.safety])
  const ordered = useMemo(() => [...results].sort((a, b) => (a.score ?? -1) - (b.score ?? -1)), [results])
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (panel.current) { L.DomEvent.disableClickPropagation(panel.current); L.DomEvent.disableScrollPropagation(panel.current) }
  }, [])

  return (
    <div className="relative isolate h-full w-full">
      <MapContainer center={[destination.lat, destination.lng]} zoom={13} className="h-full w-full" minZoom={10}
        maxBounds={[[18.2, 73.4], [18.95, 74.35]]} zoomControl={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ZoomControl position="bottomright" />
        <FitTo dest={destination} results={results} fitKey={fitKey} />
        <PanTo target={selected ? [selected.listing.lat, selected.listing.lng] : null} />
        {[1, 3, 5].map((r) => (
          <Circle key={r} center={[destination.lat, destination.lng]} radius={r * 1000} interactive={false}
            pathOptions={{ className: 'nv-ring', weight: 1.2, fill: false, dashArray: '3 6' }} />
        ))}
        {layers.metro && transit?.lines.map((l) => (
          <Polyline key={l.id} positions={l.stops.map((s) => [s.lat, s.lng] as [number, number])} interactive={false}
            pathOptions={{ className: lineClass(l.colour), weight: 4, opacity: 0.8 }} />
        ))}
        {layers.metro && transit?.stations.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={metroIcon(colours.get(s.name) ?? null, s.status !== 'open')} zIndexOffset={-200}>
            <Tooltip direction="top">{s.name} metro{s.status === 'open' ? '' : ' (under construction)'}</Tooltip>
          </Marker>
        ))}
        <PoiLayer categories={poiCats} enabled={poiCats.length > 0} />
        {layers.hidden && hidden.map((h) => (
          <CircleMarker key={h.id} center={[h.lat, h.lng]} radius={4.5} pathOptions={{ className: 'nv-ghost', weight: 1.5 }}>
            <Tooltip>{h.name}: hidden ({h.reasons.map((r) => HIDDEN_REASON_LABELS[r] ?? r).join(', ')})</Tooltip>
          </CircleMarker>
        ))}
        {selected && (
          <Polyline positions={[[selected.listing.lat, selected.listing.lng], [destination.lat, destination.lng]]} interactive={false}
            pathOptions={{ className: 'nv-route', weight: 2.5, dashArray: '7 6' }} />
        )}
        {selected && bestMess && bestMess.lat != null && bestMess.lng != null && (
          <>
            <Polyline positions={[[selected.listing.lat, selected.listing.lng], [bestMess.lat, bestMess.lng]]} interactive={false}
              pathOptions={{ className: 'nv-route-food', weight: 3, dashArray: '2 6' }} />
            <Marker position={[bestMess.lat, bestMess.lng]} icon={placeIcon('mess', 32, true)} zIndexOffset={900}
              eventHandlers={{ click: () => bestMess.poi_id && openPlace({ id: bestMess.poi_id, category: 'mess', name: bestMess.name, lat: bestMess.lat!, lng: bestMess.lng!, partial: true }) }}>
              <Tooltip permanent direction="top" className="nv-tip-quiet">Best mess: {bestMess.name}</Tooltip>
            </Marker>
          </>
        )}
        <StayMarkers ordered={ordered} selectedId={selectedId} onSelect={onSelect} />
        <Marker position={[destination.lat, destination.lng]} icon={destIcon} zIndexOffset={2000} title={destination.label}>
          <Tooltip permanent direction="bottom" className="nv-tip-quiet">{destination.short_label}</Tooltip>
        </Marker>
      </MapContainer>

      {/* On phones the panel is one row of layer chips that scrolls sideways; the colour key needs more room. */}
      <div ref={panel} className="absolute left-2 right-2 top-2 z-[400] flex flex-col gap-2.5 rounded-2xl bg-surface p-1.5 shadow-[0_2px_12px_rgb(0_0_0/0.18)] sm:bottom-6 sm:left-3 sm:right-auto sm:top-auto sm:max-w-[30rem] sm:p-3">
        <div className="flex gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible" role="group" aria-label="Map layers">
          {LAYERS.map(([k, label, sign]) => (
            <button key={k} type="button" className="chip min-h-8 shrink-0 px-3 text-[13px]" aria-pressed={layers[k]}
              onClick={() => setLayers((v) => ({ ...v, [k]: !v[k] }))}>
              {sign ? <Glyph kind={sign} size={14} tinted={!layers[k]} /> : <span className="size-2.5 rounded-full bg-[var(--pin-weak)]" aria-hidden />}{label}
            </button>
          ))}
        </div>
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:flex">
          <span className="font-semibold text-ink">Fit</span>
          {(['great', 'good', 'fair', 'weak'] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-full" style={{ background: toneColor[t] }} />{t[0].toUpperCase() + t.slice(1)}</span>
          ))}
          <span className="inline-flex items-center gap-1"><Glyph kind="college" size={13} className="text-ink" />Destination</span>
        </div>
      </div>
    </div>
  )
}
