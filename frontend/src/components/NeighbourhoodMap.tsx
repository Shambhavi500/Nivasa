import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { km, walkMin } from '../lib/format'
import { openPlace } from '../lib/placeSheet'
import type { MatchResult } from '../lib/types'
import { useTransit } from '../lib/useReference'
import { TILE_ATTRIBUTION, TILE_URL } from './mapConfig'
import { destIcon, metroIcon, nearbyPoints, placeIcon, signFor, stationColours, stayIcon } from './signs'
import { Glyph } from './ui'

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.12), { maxZoom: 16 })
    // Fit once per stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points.length])
  return null
}

export function NeighbourhoodMap({ r, destination }: { r: MatchResult; destination: { lat: number; lng: number; label: string } | null }) {
  const l = r.listing
  const transit = useTransit()
  const colours = useMemo(() => stationColours(transit), [transit])
  const points = useMemo(() => nearbyPoints(r), [r])
  // Frame the neighbourhood (places within walking range), not the whole trip to college.
  const frame = useMemo(() => [[l.lat, l.lng] as [number, number], ...points.filter((p) => p.distance_km <= 1.6).map((p) => [p.lat, p.lng] as [number, number])], [l, points])
  const near = (lat: number, lng: number) => Math.abs(lat - l.lat) < 0.03 && Math.abs(lng - l.lng) < 0.03

  return (
    <div className="flex flex-col gap-3">
      <div className="h-72 overflow-hidden rounded-2xl sm:h-80">
        <MapContainer center={[l.lat, l.lng]} zoom={15} className="h-full w-full" scrollWheelZoom={false}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <Fit points={frame} />
          {destination && (
            <>
              <Polyline positions={[[l.lat, l.lng], [destination.lat, destination.lng]]} interactive={false} pathOptions={{ className: 'nv-route', weight: 2.5, dashArray: '7 6' }} />
              <Marker position={[destination.lat, destination.lng]} icon={destIcon}><Tooltip direction="top">{destination.label}</Tooltip></Marker>
            </>
          )}
          {transit?.stations.filter((s) => near(s.lat, s.lng)).map((s) => (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={metroIcon(colours.get(s.name) ?? null, s.status !== 'open')}>
              <Tooltip direction="top">{s.name} metro{s.status === 'open' ? '' : ' (under construction)'}</Tooltip>
            </Marker>
          ))}
          {points.map((p) => (
            <Marker key={p.key} position={[p.lat, p.lng]} icon={placeIcon(p.sign, p.best ? 30 : 24, p.best)}
              eventHandlers={{ click: () => p.poi_id && openPlace({ id: p.poi_id, category: p.sign, name: p.name, lat: p.lat, lng: p.lng, partial: true }) }}>
              <Tooltip direction="top">{signFor(p.sign).label}{p.name ? `: ${p.name}` : ''} · {km(p.distance_km)}{p.poi_id ? ' · click for details' : ''}</Tooltip>
            </Marker>
          ))}
          <Marker position={[l.lat, l.lng]} icon={stayIcon(l.stay_type, r.score, true)} zIndexOffset={1000}>
            <Tooltip direction="top">{l.name}{l.location_precision === 'approximate' ? ' (approximate location)' : ''}</Tooltip>
          </Marker>
        </MapContainer>
      </div>
      <ul className="flex flex-wrap gap-1.5 text-[13px]" aria-label="Places on the map">
        <li className="badge min-h-7 gap-1.5 bg-ink text-on-ink"><Glyph kind={l.stay_type} size={13} />This stay</li>
        {points.filter((p, i) => points.findIndex((q) => q.sign === p.sign) === i).map((p) => (
          <li key={p.key} className="badge min-h-7 gap-1.5">
            <Glyph kind={p.sign} size={13} tinted />{signFor(p.sign).label} <span className="num text-muted">{walkMin(p.distance_km)} min</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
