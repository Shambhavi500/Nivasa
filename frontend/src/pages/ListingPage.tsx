import { ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, Flag, Globe, Mail, Phone, Scale, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import {
  CommuteSection, CostSection, EssentialsSection, FacilitiesSection, FoodSection, SafetySection, ScoreSection,
} from '../components/MatchSections'
import { NeighbourhoodMap } from '../components/NeighbourhoodMap'
import { ListingBadges } from '../components/ResultCard'
import { EmptyState, ErrorBox, Section, SignBadge, Spinner, Toast } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { visitChecklist } from '../lib/checklist'
import { inr, osmDirections, splitPhones, telHref, webHref } from '../lib/format'
import { fromSearchParams, hasDestination, toSearchParams } from '../lib/prefs'
import { COMPARE_MAX, compareStore, savedStore, useIds } from '../lib/storage'
import type { MatchResult } from '../lib/types'
import { lastPreferences, useReference } from '../lib/useReference'

const HOW: Partial<Record<string, string>> = { walk: 'on foot', cycle: 'by cycle', two_wheeler: 'by two-wheeler', auto: 'by auto-rickshaw' }

function ReportForm({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('rent')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    if (message.trim().length < 5) { setError('Add a few words about what is wrong.'); return }
    setStatus('sending'); setError(null)
    try {
      await api.report(listingId, topic, message.trim())
      setStatus('sent')
    } catch (err) {
      setStatus('error'); setError(err instanceof ApiError ? err.message : 'Could not send the report.')
    }
  }
  if (status === 'sent') return <p role="status" className="text-sm font-semibold text-good">Thanks. The report was saved for review.</p>
  if (!open) return <button className="btn-ghost btn -ml-3 self-start" onClick={() => setOpen(true)}><Flag className="size-4" aria-hidden />Report wrong or outdated information</button>
  return (
    <form onSubmit={send} className="flex flex-col gap-2" noValidate>
      <label className="text-sm font-semibold text-ink" htmlFor="rep-topic">What is wrong?</label>
      <select id="rep-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
        <option value="rent">Rent or deposit</option><option value="availability">Availability</option>
        <option value="facilities">Facilities</option><option value="location">Location</option>
        <option value="contact">Contact details</option><option value="closed">Closed or does not exist</option><option value="other">Something else</option>
      </select>
      <label className="sr-only" htmlFor="rep-msg">Details</label>
      <textarea id="rep-msg" className="input min-h-20" maxLength={1000} placeholder="What did you find?" value={message}
        aria-invalid={Boolean(error)} onChange={(e) => setMessage(e.target.value)} />
      {error && <p className="field-error">{error}</p>}
      <div className="flex gap-2"><button className="btn-primary btn" disabled={status === 'sending'}>{status === 'sending' ? 'Sending…' : 'Send report'}</button>
        <button type="button" className="btn-ghost btn" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  )
}

export function ListingPage() {
  const { id = '' } = useParams()
  const { search } = useLocation()
  const ref = useReference()
  const prefs = useMemo(() => {
    const p = fromSearchParams(new URLSearchParams(search))
    return hasDestination(p) ? p : lastPreferences()
  }, [search])
  const [attempt, setAttempt] = useState(0)
  const saved = useIds(savedStore).includes(id)
  const inCompare = useIds(compareStore).includes(id)
  const [notice, setNotice] = useState<string | null>(null)
  const requestKey = `${id}?${search}#${attempt}`
  const [response, setResponse] = useState<{ key: string; result: MatchResult | null; error: ApiError | null }>({ key: '', result: null, error: null })

  useEffect(() => {
    if (!prefs || !hasDestination(prefs)) return
    const ctrl = new AbortController()
    api.match(id, prefs, ctrl.signal).then(
      (result) => setResponse({ key: requestKey, result, error: null }),
      (e: unknown) => {
        if (e instanceof DOMException) return
        setResponse({ key: requestKey, result: null, error: e instanceof ApiError ? e : new ApiError(0, 'Could not load this stay.') })
      },
    )
    return () => ctrl.abort()
  }, [id, prefs, requestKey])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(t)
  }, [notice])
  const current = response.key === requestKey
  const result = current ? response.result : null
  const error = current ? response.error : null

  const back = prefs ? `/results?${toSearchParams(prefs).toString()}` : '/'
  if (!prefs) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <EmptyState title="Set your preferences first">
          <p>Nivasa needs your college and budget to work out the costs and commute for this stay.</p>
          <Link to="/" className="btn-primary btn">Set preferences</Link>
        </EmptyState>
      </div>
    )
  }
  if (error) return <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-12"><ErrorBox message={error.status === 404 ? 'This listing does not exist or is no longer active.' : error.message} onRetry={error.status === 404 ? undefined : () => setAttempt((a) => a + 1)} /><Link to={back} className="btn">Back to results</Link></div>
  if (!result || !ref.data) return <Spinner label="Loading stay" />

  const l = result.listing
  const meta = ref.data.meta
  const college = prefs.destination.college_id ? ref.data.colleges.find((c) => c.id === prefs.destination.college_id) : undefined
  const destName = college?.short_name ?? prefs.destination.label ?? 'your destination'
  const destPoint = college ? { lat: college.lat, lng: college.lng } : prefs.destination.lat != null && prefs.destination.lng != null ? { lat: prefs.destination.lat, lng: prefs.destination.lng } : null
  const directions = destPoint ? osmDirections(l, destPoint, result.commute.recommended?.mode) : null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-28 pt-5 sm:px-6 lg:pb-16">
      <Link to={back} className="btn-ghost btn -ml-3 self-start"><ArrowLeft className="size-4" aria-hidden />Back to results</Link>
      <header className="flex flex-col gap-3">
        <ListingBadges result={result} meta={meta} />
        <div className="flex items-start gap-4">
          <SignBadge kind={l.stay_type} className="mt-1 size-12 [&_svg]:size-6" />
          <div className="min-w-0">
            <h1 className="text-[34px] font-extrabold sm:text-[44px]">{l.name}</h1>
            <p className="mt-1 text-muted">{l.address ?? l.area}, Pune{l.location_precision === 'approximate' ? ' (approximate location)' : ''}</p>
          </div>
        </div>
        {l.is_demo && (
          <p className="rounded-2xl bg-demo-soft px-4 py-3 text-sm text-demo">
            <b className="text-demo">Demo listing.</b> This stay is fictional and exists to show how Nivasa works. Do not try to contact or visit it.
          </p>
        )}
        {!l.is_demo && l.description && <p className="rounded-2xl bg-surface px-4 py-3 text-sm">{l.description}</p>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Around this stay" id="around" hint="The stay, its best mess, daily needs, police, hospital and metro. Tap a sign for its name.">
            <NeighbourhoodMap r={result} destination={destPoint ? { ...destPoint, label: destName } : null} />
          </Section>
          <ScoreSection r={result} />
          <CostSection r={result} meta={meta} />
          <CommuteSection r={result} destination={destName} />
          <FoodSection r={result} wanted={prefs.cuisines} />
          <EssentialsSection r={result} meta={meta} />
          <FacilitiesSection listing={l} meta={meta} mustHaves={prefs.must_haves} />
          <SafetySection r={result} meta={meta} />
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <section className="card-lg flex flex-col gap-4 p-6" aria-labelledby="next">
            <div>
              <p className="text-sm font-semibold text-muted">All-in per month</p>
              <p className="num text-[40px] font-extrabold leading-tight tracking-[-0.04em] text-ink">{result.cost.all_in_known != null ? inr(result.cost.all_in_known) : 'Unknown'}</p>
              {result.commute.recommended && <p className="text-sm text-muted">{result.commute.recommended.minutes} min to {destName} {HOW[result.commute.recommended.mode] ?? `by ${result.commute.recommended.label}`}</p>}
            </div>
            <h2 id="next" className="sr-only">Next steps</h2>
            <div className="flex flex-col gap-2">
              {splitPhones(l.contact_phone).map((ph, i) => (
                <a key={ph} className={`btn min-h-12 ${i === 0 ? 'btn-primary' : ''}`} href={telHref(ph)}><Phone className="size-4" aria-hidden />Call {i === 0 && l.contact_name ? l.contact_name : ''} {ph}</a>
              ))}
              {l.contact_email && <a className="btn min-h-12" href={`mailto:${l.contact_email}`}><Mail className="size-4" aria-hidden /><span className="truncate">{l.contact_email}</span></a>}
              {l.contact_website && <a className="btn min-h-12" href={webHref(l.contact_website)} target="_blank" rel="noreferrer"><Globe className="size-4" aria-hidden />Website</a>}
              {!l.contact_phone && !l.contact_email && !l.contact_website && (
                <p className="rounded-2xl bg-surface px-4 py-3 text-sm">{l.is_demo ? 'Demo listings have no contact details.' : 'No phone number or email has been provided for this stay yet.'}</p>
              )}
              {!l.is_demo && (
                <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name} ${l.area} Pune`)}`} target="_blank" rel="noreferrer">
                  <Search className="size-4" aria-hidden />Find reviews and contacts on Google Maps
                </a>
              )}
              {directions && (
                <a className="btn" href={directions.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden />{directions.label} on OpenStreetMap
                </a>
              )}
              <div className="flex gap-2">
                <button className="btn flex-1" aria-pressed={saved} onClick={() => { savedStore.toggle(id); setNotice(saved ? 'Removed from saved' : 'Saved') }}>
                  {saved ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}{saved ? 'Saved' : 'Save'}
                </button>
                <button className="btn flex-1" aria-pressed={inCompare} onClick={() => {
                  const ok = compareStore.toggle(id)
                  setNotice(!ok ? `Compare holds ${COMPARE_MAX} stays. Remove one first.` : inCompare ? 'Removed from compare' : 'Added to compare')
                }}><Scale className="size-4" aria-hidden />{inCompare ? 'In compare' : 'Compare'}</button>
              </div>
            </div>
          </section>
          <Section title="Before you visit" id="visit">
            <ol className="flex flex-col gap-2.5 text-sm">
              {visitChecklist(result, destName).map((t, i) => (
                <li key={t} className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-bold text-ink">{i + 1}</span><span className="pt-0.5">{t}</span></li>
              ))}
            </ol>
          </Section>
          <Section title="About this information" id="source">
            <p className="text-sm text-muted">Source: {l.data_source}. Status: {l.verification_status.replace('_', ' ')}{l.verified_on ? ` on ${l.verified_on}` : ''}.</p>
            <ReportForm listingId={id} />
          </Section>
        </aside>
      </div>
      {/* On phones the next-step card sits below every section, so the main actions stay pinned to the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-[700] flex items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="num truncate text-[15px] font-extrabold text-ink">{result.cost.all_in_known != null ? `${inr(result.cost.all_in_known)}/mo` : 'Rent unknown'}</p>
          {result.commute.recommended && <p className="truncate text-xs text-muted">{result.commute.recommended.minutes} min to {destName}</p>}
        </div>
        <button className="btn btn-icon min-h-12 shrink-0" aria-pressed={saved} onClick={() => { savedStore.toggle(id); setNotice(saved ? 'Removed from saved' : 'Saved') }}>
          {saved ? <BookmarkCheck className="size-5" aria-hidden /> : <Bookmark className="size-5" aria-hidden />}<span className="sr-only">{saved ? 'Saved' : 'Save'}</span>
        </button>
        {l.contact_phone ? (
          <a className="btn-primary btn min-h-12 shrink-0" href={`tel:${l.contact_phone.replace(/\s/g, '')}`}><Phone className="size-4" aria-hidden />Call</a>
        ) : directions && (
          <a className="btn-primary btn min-h-12 shrink-0" href={directions.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />Directions</a>
        )}
      </div>
      <Toast message={notice} />
    </div>
  )
}
