import { List, Map as MapIcon, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { PreferenceForm } from '../components/PreferenceForm'
import { ResultCard } from '../components/ResultCard'
import { ResultsMap } from '../components/ResultsMap'
import { EmptyState, ErrorBox, ScoreRing, SignBadge, Spinner, Toast } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { inr } from '../lib/format'
import { fromSearchParams, hasDestination, toSearchParams, type PrefErrors } from '../lib/prefs'
import type { MatchResult, SearchResponse } from '../lib/types'
import { rememberPreferences, useReference } from '../lib/useReference'

type Sort = 'score' | 'cost' | 'commute' | 'rent'
const SORTS: Record<Sort, (a: MatchResult, b: MatchResult) => number> = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  cost: (a, b) => (a.cost.all_in_known ?? Infinity) - (b.cost.all_in_known ?? Infinity),
  commute: (a, b) => (a.commute.recommended?.minutes ?? Infinity) - (b.commute.recommended?.minutes ?? Infinity),
  rent: (a, b) => (a.cost.rent.amount ?? Infinity) - (b.cost.rent.amount ?? Infinity),
}
const SORT_LABELS: Record<Sort, string> = { score: 'Best fit', cost: 'Lowest all-in', commute: 'Shortest trip', rent: 'Lowest rent' }
// A search near a central college matches 150+ stays; render them a page at a time so phones stay smooth.
const PAGE = 25

const desktopQuery = '(min-width: 1024px)'
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(desktopQuery); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia(desktopQuery).matches,
    () => true,
  )
}

export function ResultsPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const prefs = useMemo(() => fromSearchParams(new URLSearchParams(search)), [search])
  const ref = useReference()
  const [selected, setSelected] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('score')
  const [page, setPage] = useState({ key: '', n: PAGE })
  const [pane, setPane] = useState<'list' | 'map'>('list')
  // Leaflet must mount at its real size, so on phones the map only exists while its tab is open.
  const isDesktop = useIsDesktop()
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  // The response is tagged with the request it answers; anything older counts as still loading.
  const requestKey = `${search}#${attempt}`
  const [response, setResponse] = useState<{ key: string; data: SearchResponse | null; error: ApiError | null }>({ key: '', data: null, error: null })

  useEffect(() => {
    if (!hasDestination(prefs)) return
    rememberPreferences(prefs)
    const ctrl = new AbortController()
    api.search(prefs, ctrl.signal).then(
      (data) => { setResponse({ key: requestKey, data, error: null }); setSelected(null) },
      (err: unknown) => {
        if (err instanceof DOMException) return
        setResponse({ key: requestKey, data: null, error: err instanceof ApiError ? err : new ApiError(0, 'Search failed.') })
      },
    )
    return () => ctrl.abort()
  }, [prefs, requestKey])
  const loading = response.key !== requestKey
  const state = { data: loading ? null : response.data, error: loading ? null : response.error, loading }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!selected) return
    listRef.current?.querySelector(`[data-listing="${CSS.escape(selected)}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  // The edit drawer closes on Escape wherever focus is, and the page behind it does not scroll.
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false) }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [editing])

  if (!hasDestination(prefs)) return <Navigate to="/" replace />

  const data = state.data
  const sorted = data ? [...data.results].sort(SORTS[sort]) : []
  // The page resets with every new search or sort, and always reaches the stay picked on the map.
  const pageKey = `${requestKey}|${sort}`
  const shown = Math.max(page.key === pageKey ? page.n : PAGE, sorted.findIndex((r) => r.listing.id === selected) + 1)
  const qs = toSearchParams(prefs).toString()
  const serverErrors: PrefErrors = {}
  if (state.error?.status === 422) {
    for (const [field, msg] of Object.entries(state.error.fieldErrors)) {
      const key = field.split('.')[0] as keyof PrefErrors
      serverErrors[key in { destination: 1, budget: 1, stay_types: 1, modes: 1, weights: 1, max_commute_min: 1 } ? key : 'destination'] = msg
    }
  }
  const hiddenBits = data ? Object.entries(data.hidden_counts).map(([k, n]) => `${n} ${{ budget: 'over budget', commute: `beyond ${prefs.max_commute_min} min`, sharing: 'without that room type' }[k] ?? k}`) : []
  const picked = pane === 'map' && selected && data ? data.results.find((x) => x.listing.id === selected) ?? null : null

  return (
    <div className="flex h-full flex-col lg:grid lg:grid-cols-[minmax(400px,480px)_1fr]">
      <div className="flex min-h-0 flex-col lg:border-r lg:border-line">
        <div className="flex flex-col gap-3 border-b border-line bg-surface px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <SignBadge kind="college" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-muted">Stays near</p>
              <h1 className="line-clamp-2 text-[19px] leading-tight tracking-[-0.02em] sm:text-[22px]">{data?.destination.label ?? '…'}</h1>
              <p className="num mt-0.5 text-[13px] text-muted">{inr(prefs.budget)} {prefs.budget_mode === 'all_in' ? 'all-in' : 'rent'} · {prefs.gender === 'boys' ? "Boys'" : "Girls'"} & co-ed · up to {prefs.max_commute_min} min</p>
            </div>
            <button className="btn shrink-0" onClick={() => setEditing(true)}><SlidersHorizontal className="size-4" aria-hidden />Edit</button>
          </div>
          <div className="flex gap-1 rounded-full bg-surface-2 p-1 lg:hidden" role="tablist" aria-label="Show results as">
            {(['list', 'map'] as const).map((p) => (
              <button key={p} role="tab" aria-selected={pane === p} onClick={() => setPane(p)}
                className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold ${pane === p ? 'bg-ink text-on-ink' : 'text-ink'}`}>
                {p === 'list' ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}{p === 'list' ? 'List' : 'Map'}
              </button>
            ))}
          </div>
        </div>

        <div ref={listRef} className={`${pane === 'map' ? 'hidden lg:flex' : 'flex'} min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:px-5`} aria-live="polite" aria-busy={state.loading}>
          {state.loading && <Spinner label="Matching stays" />}
          {state.error && (
            <ErrorBox message={state.error.message} onRetry={state.error.status === 422 ? () => setEditing(true) : () => setAttempt((a) => a + 1)} />
          )}
          {data && !state.loading && (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-[15px]"><b className="text-2xl font-extrabold tracking-[-0.03em]">{data.results.length}</b> of {data.total_considered} stays fit your preferences.</p>
                {hiddenBits.length > 0 && <p className="text-[13px] text-muted">Hidden: {hiddenBits.join(' · ')}.</p>}
                {data.budget_suggestion && (
                  <button className="btn btn-sm self-start" onClick={() => navigate(`/results?${toSearchParams({ ...prefs, budget: data.budget_suggestion!.budget }).toString()}`)}>
                    Raise budget to {inr(data.budget_suggestion.budget)} to see {data.budget_suggestion.extra_results} more
                  </button>
                )}
                {data.includes_demo && <p className="rounded-2xl bg-demo-soft px-3.5 py-2.5 text-[13px] text-demo">Listings marked <b className="text-demo">Demo</b> are fictional examples. Real, verified listings will replace them.</p>}
              </div>
              {data.results.length > 1 && (
                <div className="-mx-4 flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5" role="radiogroup" aria-label="Sort by">
                  {(Object.keys(SORTS) as Sort[]).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={sort === s} className="chip shrink-0" onClick={() => setSort(s)}>{SORT_LABELS[s]}</button>
                  ))}
                </div>
              )}
              {data.results.length === 0 && (
                <EmptyState title="No stays match every preference">
                  <p>Try a higher budget, a longer commute, more travel modes, or another room type.</p>
                  <button className="btn-primary btn" onClick={() => setEditing(true)}>Edit preferences</button>
                </EmptyState>
              )}
              {ref.data && sorted.slice(0, shown).map((r) => (
                <ResultCard key={r.listing.id} result={r} meta={ref.data.meta} destinationLabel={data.destination.short_label}
                  detailHref={`/listings/${encodeURIComponent(r.listing.id)}?${qs}`} selected={selected === r.listing.id}
                  onSelect={() => setSelected(r.listing.id)} onNotice={setNotice} />
              ))}
              {sorted.length > shown && (
                <button className="btn min-h-12" onClick={() => setPage({ key: pageKey, n: shown + PAGE })}>
                  Show {Math.min(PAGE, sorted.length - shown)} more <span className="text-muted">({sorted.length - shown} left)</span>
                </button>
              )}
              <p className="pb-4 text-xs text-muted">{data.data_notice}</p>
            </>
          )}
        </div>
      </div>

      <div className={`${pane === 'list' ? 'hidden lg:block' : 'block'} relative h-[calc(100dvh-12rem)] min-h-[420px] lg:h-full`}>
        {data && (isDesktop || pane === 'map') && (
          <ResultsMap destination={data.destination} results={data.results} hidden={data.hidden} selectedId={selected}
            onSelect={setSelected} fitKey={qs} />
        )}
        {!data && <div className="grid h-full place-items-center bg-surface-2 text-muted">{state.loading ? 'Loading map…' : 'Map unavailable'}</div>}

        {picked && (
          <div className="absolute bottom-3 left-3 right-[4.25rem] z-[600] flex items-center gap-2.5 rounded-2xl bg-surface p-2.5 shadow-[0_4px_16px_rgb(0_0_0/0.22)] lg:hidden">
            <ScoreRing score={picked.score} size={44} />
            <div className="min-w-0 flex-1">
              <b className="block truncate">{picked.listing.name}</b>
              <span className="num text-xs text-muted">{picked.cost.all_in_known != null ? `${inr(picked.cost.all_in_known)} all-in` : 'Rent not reported'}{picked.commute.recommended ? ` · ${picked.commute.recommended.minutes} min` : ''}</span>
            </div>
            <Link className="btn-primary btn shrink-0" to={`/listings/${encodeURIComponent(picked.listing.id)}?${qs}`}>Details</Link>
            <button className="btn-ghost btn btn-icon shrink-0" onClick={() => setSelected(null)}><X className="size-4" aria-hidden /><span className="sr-only">Close</span></button>
          </div>
        )}
      </div>

      {editing && ref.data && (
        <div className="fixed inset-0 z-[900] flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Edit preferences"
          onClick={(e) => e.target === e.currentTarget && setEditing(false)}>
          <div className="h-full w-full max-w-xl overflow-y-auto bg-surface-2 px-5 pt-5 sm:rounded-l-[32px] sm:px-8 sm:pt-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[26px] tracking-[-0.03em]">Edit preferences</h2>
              <button className="btn btn-icon" onClick={() => setEditing(false)} autoFocus><X className="size-5" aria-hidden /><span className="sr-only">Close</span></button>
            </div>
            <PreferenceForm initial={prefs} meta={ref.data.meta} colleges={ref.data.colleges} submitLabel="Update results" serverErrors={serverErrors}
              onSubmit={(p) => { setEditing(false); navigate(`/results?${toSearchParams(p).toString()}`) }} />
          </div>
        </div>
      )}

      <Toast message={notice} />
    </div>
  )
}
