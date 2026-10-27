import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ResultCard } from '../components/ResultCard'
import { EmptyState, ErrorBox, ScoreRing, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { inr } from '../lib/format'
import { toSearchParams } from '../lib/prefs'
import { compareStore, savedStore, useIds } from '../lib/storage'
import type { MatchResult, Meta, Preferences } from '../lib/types'
import { lastPreferences, useReference } from '../lib/useReference'

/** Scores saved or compared stays with the student's most recent search. */
function useMatches(ids: string[], prefs: Preferences | null) {
  const [state, setState] = useState<{ results: MatchResult[]; missing: string[]; error: string | null; loading: boolean }>(
    { results: [], missing: [], error: null, loading: false })
  const key = ids.join(',')
  useEffect(() => {
    if (!prefs || !ids.length) { setState({ results: [], missing: [], error: null, loading: false }); return }
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.allSettled(ids.map((id) => api.match(id, prefs, ctrl.signal))).then((settled) => {
      if (ctrl.signal.aborted) return
      const results: MatchResult[] = []
      const missing: string[] = []
      let error: string | null = null
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') results.push(s.value)
        else if (s.reason instanceof ApiError && s.reason.status === 404) missing.push(ids[i])
        else error = s.reason instanceof Error ? s.reason.message : 'Could not load some stays.'
      })
      setState({ results, missing, error, loading: false })
    })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefs])
  return state
}

function NeedsSearch() {
  return (
    <EmptyState title="Run a search first">
      <p>Nivasa scores stays against your college and budget. Set your preferences, then come back.</p>
      <Link to="/" className="btn-primary btn">Set preferences</Link>
    </EmptyState>
  )
}

export function SavedPage() {
  const ids = useIds(savedStore)
  const ref = useReference()
  const prefs = useMemo(() => lastPreferences(), [])
  const { results, missing, error, loading } = useMatches(ids, prefs)
  const qs = prefs ? toSearchParams(prefs).toString() : ''
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-16 pt-10 sm:px-6">
      <div><h1 className="text-[36px] font-extrabold sm:text-[44px]">Saved stays</h1><p className="mt-1 text-muted">Kept on this device. Scores use your latest search.</p></div>
      {!ids.length && <EmptyState title="Nothing saved yet"><p>Tap Save on any stay to keep it here.</p><Link to="/" className="btn-primary btn">Find stays</Link></EmptyState>}
      {ids.length > 0 && !prefs && <NeedsSearch />}
      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}
      {missing.length > 0 && <p className="flex flex-wrap items-center gap-2 text-sm text-muted">{missing.length} saved stay{missing.length > 1 ? 's are' : ' is'} no longer listed. <button className="btn btn-sm" onClick={() => missing.forEach((m) => savedStore.toggle(m))}>Remove</button></p>}
      <div className="grid gap-3 md:grid-cols-2">
        {ref.data && results.map((r) => (
          <ResultCard key={r.listing.id} result={r} meta={ref.data.meta} destinationLabel="your destination"
            detailHref={`/listings/${encodeURIComponent(r.listing.id)}?${qs}`} />
        ))}
      </div>
    </div>
  )
}

function CompareTable({ results, meta, qs }: { results: MatchResult[]; meta: Meta; qs: string }) {
  type Row = [string, (r: MatchResult) => number | null, 'max' | 'min' | null, (r: MatchResult) => React.ReactNode]
  const unknown = <span className="italic text-muted">Not reported</span>
  const rows: Row[] = [
    ['Best-Fit score', (r) => r.score, 'max', (r) => <ScoreRing score={r.score} size={44} />],
    ['All-in per month', (r) => r.cost.all_in_known, 'min', (r) => (r.cost.all_in_known != null ? inr(r.cost.all_in_known) : unknown)],
    ['Rent', (r) => r.cost.rent.amount, 'min', (r) => (r.cost.rent.amount != null ? `${inr(r.cost.rent.amount)} · ${r.cost.sharing ? meta.sharing[r.cost.sharing] : ''}` : unknown)],
    ['Deposit', (r) => r.listing.deposit, 'min', (r) => (r.listing.deposit != null ? inr(r.listing.deposit) : unknown)],
    ['To college', (r) => r.commute.recommended?.minutes ?? null, 'min', (r) => (r.commute.recommended ? `${r.commute.recommended.minutes} min · ${r.commute.recommended.label}` : 'No option')],
    ['Food match', (r) => (r.food[0]?.coverage ?? null), 'max', (r) => (r.food[0] ? `${r.food[0].coverage != null ? `${Math.round(r.food[0].coverage * 100)}% · ` : ''}${r.food[0].name}` : 'No mess mapped')],
    ['Facilities confirmed', (r) => Object.values(r.listing.amenities).filter(Boolean).length, 'max', (r) => `${Object.values(r.listing.amenities).filter(Boolean).length} of ${Object.keys(meta.amenities).length}`],
    ['Essentials within 10 min', (r) => r.essentials.within_walk, 'max', (r) => `${r.essentials.within_walk} of ${r.essentials.categories_total}`],
    ['Curfew', () => null, null, (r) => r.listing.curfew ?? unknown],
    ['Warnings', () => null, null, (r) => (r.warnings.length ? <ul className="list-disc pl-4 text-xs">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : 'None')],
  ]
  // The row labels stay put while the stays scroll sideways on a phone.
  const rowLabel = 'sticky left-0 z-10 w-28 bg-surface-2 p-3 sm:w-40 sm:p-4'
  return (
    <div className="flex flex-col gap-2">
      {results.length > 1 && <p className="text-xs text-muted sm:hidden">Swipe the table sideways to see every stay.</p>}
      <div className="overflow-x-auto rounded-[32px] bg-surface-2">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm sm:min-w-[640px]">
          <thead>
            <tr>
              <th className={rowLabel} />
              {results.map((r) => (
                <th key={r.listing.id} className="p-4 text-left align-top">
                  <span className="text-base font-bold text-ink">{r.listing.name}</span>
                  {r.listing.is_demo && <span className="badge badge-demo ml-1.5">Demo</span>}
                  <div className="text-xs font-normal text-muted">{r.listing.area} · {meta.stay_types[r.listing.stay_type]}</div>
                  <div className="mt-2 flex gap-1.5">
                    <Link to={`/listings/${encodeURIComponent(r.listing.id)}?${qs}`} className="btn btn-sm">Details</Link>
                    <button className="btn-ghost btn btn-sm" onClick={() => compareStore.toggle(r.listing.id)}>Remove</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value, dir, render]) => {
              const vals = results.map(value)
              const known = vals.filter((v): v is number => v != null)
              // Only mark a winner when the values differ; three stays with "0 of 12" have no best.
              const best = dir && new Set(known).size > 1 ? (dir === 'max' ? Math.max(...known) : Math.min(...known)) : null
              return (
                <tr key={label}>
                  <th scope="row" className={`label border-t border-line text-left align-top ${rowLabel}`}>{label}</th>
                  {results.map((r, i) => (
                    <td key={r.listing.id} className={`num border-t border-line p-3 align-top text-ink sm:p-4 ${best != null && vals[i] === best ? 'bg-good-soft font-bold' : ''}`}>{render(r)}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ComparePage() {
  const ids = useIds(compareStore)
  const ref = useReference()
  const prefs = useMemo(() => lastPreferences(), [])
  const { results, error, loading } = useMatches(ids, prefs)
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-16 pt-10 sm:px-6">
      <div><h1 className="text-[36px] font-extrabold sm:text-[44px]">Compare stays</h1><p className="mt-1 text-muted">Up to three stays side by side, scored with your latest search. Green marks the best known value in each row.</p></div>
      {!ids.length && <EmptyState title="Nothing to compare yet"><p>Use the Compare button on up to three stays.</p><Link to="/" className="btn-primary btn">Find stays</Link></EmptyState>}
      {ids.length > 0 && !prefs && <NeedsSearch />}
      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}
      {ref.data && results.length > 0 && <CompareTable results={results} meta={ref.data.meta} qs={prefs ? toSearchParams(prefs).toString() : ''} />}
    </div>
  )
}
