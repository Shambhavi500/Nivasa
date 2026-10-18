import { Clock, ExternalLink, Globe, Mail, MapPin, Navigation, Phone, Search, Siren, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { splitPhones, telHref, webHref, webLabel } from '../lib/format'
import { closePlace, usePlaceSheet, type PlaceRef } from '../lib/placeSheet'
import type { Poi } from '../lib/types'
import { signFor } from './signs'
import { SignBadge, Spinner } from './ui'

const OSM_KIND: Record<string, string> = { n: 'node', w: 'way', r: 'relation' }


const KIND_LABEL: Record<string, string> = { hospital: 'Hospital', clinic: 'Clinic', doctor: "Doctor's clinic", doctors: "Doctor's clinic" }

function isFull(p: PlaceRef): p is Poi {
  return !('partial' in p)
}

/** Mounted once in the layout; shows whichever place `openPlace` last opened. */
export function PlaceSheetHost() {
  const ref = usePlaceSheet()
  const [loaded, setLoaded] = useState<{ id: string; poi: Poi | null }>({ id: '', poi: null })
  const close = useRef<HTMLButtonElement>(null)
  const full = !ref ? null : isFull(ref) ? ref : loaded.id === ref.id ? loaded.poi : null
  const failed = !!ref && !isFull(ref) && loaded.id === ref.id && loaded.poi === null

  useEffect(() => {
    if (!ref || isFull(ref)) return
    let live = true
    const id = ref.id
    api.poi(id).then((p) => { if (live) setLoaded({ id, poi: p }) }).catch(() => { if (live) setLoaded({ id, poi: null }) })
    return () => { live = false }
  }, [ref])

  useEffect(() => {
    if (!ref) return
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePlace() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ref])

  if (!ref) return null
  const sign = signFor(ref.category)
  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center sm:items-stretch sm:justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/35" onClick={closePlace} />
      <section role="dialog" aria-modal="true" aria-labelledby="place-title"
        className="relative flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-[28px] bg-surface p-5 shadow-2xl sm:m-3 sm:max-h-none sm:w-[26rem] sm:rounded-[28px] sm:p-6">
        <div className="flex items-start gap-3">
          <SignBadge kind={ref.category} className="size-11 [&_svg]:size-5" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-muted">{full?.details?.kind ? KIND_LABEL[full.details.kind] ?? sign.label : sign.label}</p>
            <h2 id="place-title" className="text-[22px] leading-tight">{ref.name ?? `Unnamed ${sign.label.toLowerCase()}`}</h2>
            {full?.details?.name_mr && full.details.name_mr !== ref.name && <p className="text-sm text-muted">{full.details.name_mr}</p>}
          </div>
          <button ref={close} type="button" className="btn-ghost btn btn-icon -mr-2 -mt-1 shrink-0" onClick={closePlace}>
            <X className="size-5" aria-hidden /><span className="sr-only">Close</span>
          </button>
        </div>
        {full ? <PlaceBody p={full} /> : failed ? <p className="mt-4 text-sm text-bad">Could not load this place. Try again in a moment.</p> : <Spinner label="Loading details" />}
      </section>
    </div>
  )
}

function PlaceBody({ p }: { p: Poi }) {
  const d = p.details ?? {}
  const phones = splitPhones(p.phone)
  const emergencyPhones = splitPhones(d.emergency_phone)
  const health = p.category === 'hospital' || p.category === 'pharmacy'
  const hasContact = phones.length > 0 || !!p.email || !!p.website
  const search = encodeURIComponent(`${p.name ?? signFor(p.category).label} Pune`)
  const osmUrl = `https://www.openstreetmap.org/${OSM_KIND[p.id[0]] ?? 'node'}/${p.id.slice(1)}`
  const tags: string[] = []
  if (d.emergency === 'yes') tags.push('Emergency department')
  if (d.operator_type) tags.push(d.operator_type === 'public' || d.operator_type === 'government' ? 'Government' : d.operator_type === 'private' ? 'Private' : d.operator_type)
  if (p.pure_veg) tags.push('Pure veg')
  if (p.pure_veg === false) tags.push('Veg and non-veg')
  if (p.jain) tags.push('Jain food')
  if (d.takeaway === 'yes') tags.push('Takeaway')
  if (d.delivery === 'yes') tags.push('Delivers')
  if (d.wheelchair === 'yes') tags.push('Wheelchair access')

  return (
    <div className="mt-4 flex flex-col gap-4">
      {(tags.length > 0 || p.cuisine?.length) && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => <span key={t} className="badge">{t}</span>)}
          {p.cuisine?.map((c) => <span key={c} className="badge bg-ink text-on-ink">{c}</span>)}
        </div>
      )}

      <dl className="flex flex-col gap-2.5 text-sm">
        {p.address && <Row icon={<MapPin className="size-4" />} label="Address">{p.address}</Row>}
        {p.opening_hours && <Row icon={<Clock className="size-4" />} label="Hours">{p.opening_hours.replace(/;\s*/g, '; ')}</Row>}
        {d.speciality && <Row label="Specialities">{d.speciality}</Row>}
        {d.operator && <Row label="Run by">{d.operator}</Row>}
        {d.beds && <Row label="Beds">{d.beds}</Row>}
        {d.description && <Row label="About">{d.description}</Row>}
        {d.note && <Row label="Note">{d.note}</Row>}
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Contact</h3>
        {phones.map((ph, i) => (
          <a key={ph} className={`btn min-h-11 justify-start ${i === 0 ? 'btn-primary' : ''}`} href={telHref(ph)}>
            <Phone className="size-4" aria-hidden />Call {ph}
          </a>
        ))}
        {emergencyPhones.map((ph) => (
          <a key={ph} className="btn min-h-11 justify-start" href={telHref(ph)}><Siren className="size-4 text-bad" aria-hidden />Emergency: {ph}</a>
        ))}
        {p.email && <a className="btn min-h-11 justify-start" href={`mailto:${p.email}`}><Mail className="size-4" aria-hidden /><span className="truncate">{p.email}</span></a>}
        {p.website && (
          <a className="btn min-h-11 justify-start" href={webHref(p.website)} target="_blank" rel="noreferrer">
            <Globe className="size-4" aria-hidden /><span className="truncate">{webLabel(p.website)}</span>
          </a>
        )}
        {!hasContact && (
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
            No phone number or email is mapped for this place yet. Google Maps often lists one.
          </p>
        )}
        <div className="flex gap-2">
          <a className="btn flex-1" href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat}%2C${p.lng}`} target="_blank" rel="noreferrer">
            <Navigation className="size-4" aria-hidden />Directions
          </a>
          <a className="btn flex-1" href={`https://www.google.com/maps/search/?api=1&query=${search}`} target="_blank" rel="noreferrer">
            <Search className="size-4" aria-hidden />Google Maps
          </a>
        </div>
      </div>

      {health && (
        <p className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
          Medical emergency? Call <a className="font-bold underline" href="tel:108">108</a> for an ambulance or <a className="font-bold underline" href="tel:112">112</a>.
        </p>
      )}

      <p className="text-xs text-muted">
        {p.contact_source ? `Contacts: ${p.contact_source}. ` : ''}Location and details from OpenStreetMap; numbers can change, so confirm before you visit.{' '}
        <a className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-ink" href={osmUrl} target="_blank" rel="noreferrer">
          Fix on OpenStreetMap<ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
    </div>
  )
}

function Row({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <dt className="flex w-24 shrink-0 items-start gap-1.5 pt-px font-semibold text-muted">{icon}{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{children}</dd>
    </div>
  )
}
