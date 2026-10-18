import type { ReactNode } from 'react'
import { Check, ChevronRight, CircleHelp, Minus } from 'lucide-react'
import { inr, km, scoreBand, toneColor, walkMin } from '../lib/format'
import { openPlace } from '../lib/placeSheet'
import type { Listing, MatchResult, Meta, NearbyPlace } from '../lib/types'
import { Fact, ScoreRing, Section, SignBadge } from './ui'

const BASIS_LABEL: Record<string, string> = {
  reported: 'Reported by the listing', included: 'Included', estimate: 'Estimate', unknown: 'Not reported', not_needed: 'No cost',
}

export function ScoreSection({ r }: { r: MatchResult }) {
  return (
    <Section title="Best-Fit score" id="score" hint="Each factor is scored out of 100 and weighted by your priorities. Factors without data are left out, not guessed, and the score is lowered to reflect what is missing.">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <ScoreRing score={r.score} size={84} />
        <div className="grid flex-1 grid-cols-[minmax(6.5rem,auto)_1fr_2.2rem] items-center gap-x-3 gap-y-2 text-sm">
          {r.factors.map((f) => (
            <div key={f.key} className="contents">
              <span className="font-semibold text-ink">{f.label} <span className="text-xs font-normal text-muted">×{f.weight}</span></span>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3" title={f.detail}>
                {f.score != null && <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: toneColor[scoreBand(f.score).tone] }} />}
              </div>
              <span className="num text-right text-xs font-bold text-ink">{f.score ?? '–'}</span>
              <span className="col-span-3 -mt-1 mb-1 text-xs text-muted">{f.detail}</span>
            </div>
          ))}
        </div>
      </div>
      {r.score_coverage < 1 && (
        <p className="rounded-2xl bg-surface px-4 py-3 text-sm">The factors that could be assessed average {r.assessed_score}. Because {100 - Math.round(r.score_coverage * 100)}% of your weighting is not reported, the score is lowered to {r.score}. Ask the owner about the missing details.</p>
      )}
    </Section>
  )
}

export function CostSection({ r, meta }: { r: MatchResult; meta: Meta }) {
  const c = r.cost
  const rows: [string, typeof c.rent][] = [['Rent', c.rent], ['Food', c.food], ['Travel to college', c.travel], ['Electricity', c.electricity]]
  return (
    <Section title="Your month here" id="cost" hint={c.budget_mode === 'all_in' ? 'Compared with your all-in budget.' : 'Your budget covers rent only.'}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, line]) => (
            <tr key={label} className="border-b border-line align-top">
              <td className="py-2.5 pr-3 font-medium text-ink">
                {label}{label === 'Rent' && c.sharing ? ` (${meta.sharing[c.sharing].toLowerCase()})` : ''}
                <span className="block text-xs font-normal text-muted">{line.note}</span>
              </td>
              <td className="whitespace-nowrap py-2.5 text-right">
                <span className="num font-bold text-ink">{line.amount != null ? inr(line.amount) : <span className="font-normal italic text-faint">Unknown</span>}</span>
                <span className="block text-xs text-muted">{BASIS_LABEL[line.basis]}</span>
              </td>
            </tr>
          ))}
          <tr>
            <td className="pt-3.5 font-bold text-ink">All-in per month (known parts)</td>
            <td className="num pt-3.5 text-right text-2xl font-extrabold tracking-[-0.03em] text-ink">{c.all_in_known != null ? inr(c.all_in_known) : <span className="text-sm font-normal italic text-faint">Unknown</span>}</td>
          </tr>
        </tbody>
      </table>
      {c.difference != null && (
        <p className={`self-start rounded-full px-3 py-1 text-sm font-semibold ${c.difference >= 0 ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
          {c.difference >= 0 ? `${inr(c.difference)} under` : `${inr(-c.difference)} over`} your {inr(c.budget)} {c.budget_mode === 'all_in' ? 'all-in' : 'rent'} budget
        </p>
      )}
      {c.unknown_parts.length > 0 && <p className="text-sm text-warn">Not included because they are unknown: {c.unknown_parts.join(', ')}.</p>}
      <p className="text-xs text-muted">Deposit: <Fact value={r.listing.deposit != null ? inr(r.listing.deposit) : null} />. Other rooms:{' '}
        {r.listing.rooms.length ? r.listing.rooms.map((rm) => `${meta.sharing[rm.sharing].toLowerCase()} ${rm.monthly_rent != null ? inr(rm.monthly_rent) : '(rent not reported)'}`).join(', ') : 'not reported'}.</p>
    </Section>
  )
}

export function CommuteSection({ r, destination }: { r: MatchResult; destination: string }) {
  return (
    <Section title={`Getting to ${destination}`} id="commute" sign="college"
      hint={`${km(r.commute.distance_km)} by road (${r.commute.routing_source === 'osrm' ? 'OSRM routing' : 'estimated from straight-line distance'}). One-way times, monthly cost for 24 college days.`}>
      <ul className="flex flex-col gap-1.5">
        {r.commute.options.map((o) => {
          const best = r.commute.recommended?.mode === o.mode
          const dim = !o.available || !o.in_preferences
          return (
            <li key={o.mode} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${best ? 'bg-surface shadow-[0_0_0_2px_var(--ink)]' : 'bg-surface/60'} ${dim ? 'opacity-60' : ''}`}>
              <SignBadge kind={o.mode} small />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
                  {o.label}{best && <span className="badge min-h-5 bg-ink px-2 text-[11px] text-on-ink">Best for you</span>}
                </p>
                <p className="text-xs text-muted">{o.note}{o.available && !o.in_preferences ? ' (not one of your travel modes)' : ''}</p>
              </div>
              <div className="num shrink-0 text-right">
                <p className="text-sm font-bold text-ink">{o.available && o.minutes != null ? `${o.minutes} min` : 'n/a'}</p>
                <p className="text-xs text-muted">{o.available ? (o.monthly_cost ? `${inr(o.monthly_cost)}/mo` : 'Free') : ''}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

export function FoodSection({ r, wanted }: { r: MatchResult; wanted: string[] }) {
  return (
    <Section title="Food within 1.5 km" id="food" sign="mess"
      hint={`Sorted by how well each kitchen covers ${wanted.length ? wanted.join(', ') : 'your diet'}. Messes come from OpenStreetMap, which lists only some of them.`}>
      {r.food.length === 0 && <p className="text-sm text-muted">No messes are mapped near here yet. That does not mean there are none; ask the owner or residents.</p>}
      <ul className="flex flex-col gap-1.5">
        {r.food.map((f, i) => (
          <li key={`${f.kind}-${f.poi_id ?? i}`} className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b>{f.name}{i === 0 && <span className="badge ml-2 min-h-5 bg-ink px-2 text-[11px] text-on-ink">Best match</span>}</b>
              <span className="num text-xs text-muted">{f.kind === 'in_house' ? 'In this stay' : `${km(f.distance_km)} · ${walkMin(f.distance_km)} min walk`}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {f.cuisines ? f.cuisines.map((cz) => (
                <span key={cz} className={`badge ${f.matched.includes(cz) ? 'bg-ink text-on-ink' : ''}`}>{cz}</span>
              )) : <span className="text-xs italic text-faint">Menu not reported</span>}
            </div>
            <p className="text-xs text-muted">
              Pure veg: {f.pure_veg == null ? 'not reported' : f.pure_veg ? 'yes' : 'no'} · Jain: {f.jain == null ? 'not reported' : f.jain ? 'yes' : 'no'}
              {f.opening_hours ? ` · Hours: ${f.opening_hours}` : ''}
            </p>
            {f.poi_id && f.lat != null && f.lng != null && (
              <button type="button" className="btn btn-sm self-start"
                onClick={() => openPlace({ id: f.poi_id!, category: 'mess', name: f.name, lat: f.lat!, lng: f.lng!, partial: true })}>
                Details and contact<ChevronRight className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function FacilitiesSection({ listing, meta, mustHaves }: { listing: Listing; meta: Meta; mustHaves: string[] }) {
  return (
    <Section title="Facilities" id="facilities" hint="Ticks are confirmed, dashes are confirmed absent, question marks are not reported.">
      <ul className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {Object.entries(meta.amenities).map(([k, label]) => {
          const v = listing.amenities[k]
          const must = mustHaves.includes(k)
          return (
            <li key={k} className={`flex items-center gap-2.5 ${v === false ? 'text-muted' : 'text-ink'} ${must && v !== true ? 'font-semibold text-bad' : ''}`}>
              {v === true
                ? <span className="grid size-5 place-items-center rounded-full bg-good-soft"><Check className="size-3.5 text-good" aria-label="Yes" /></span>
                : v === false
                  ? <span className="grid size-5 place-items-center rounded-full bg-surface-3"><Minus className="size-3.5" aria-label="No" /></span>
                  : <CircleHelp className="size-5 text-faint" aria-label="Not reported" />}
              {label}{must && v !== true ? (v === false ? ' (your must-have)' : ' (must-have, not confirmed)') : ''}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

export function EssentialsSection({ r, meta }: { r: MatchResult; meta: Meta }) {
  return (
    <Section title="Daily essentials nearby" id="essentials" sign="grocery" hint="Nearest mapped place in each category, by estimated walking distance. From OpenStreetMap; small shops are often missing.">
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {Object.entries(meta.essentials).map(([k, label]) => {
          const p = r.essentials.by_category[k]
          return (
            <li key={k}>
              <PlaceRow kind={k} place={p} className={p ? '' : 'opacity-60'}>
                <SignBadge kind={k} small />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{label}</p>
                  <p className="truncate text-xs text-muted">{p ? p.name ?? 'Unnamed' : 'None mapped within 1.5 km'}</p>
                </div>
                {p && <span className="num shrink-0 text-right text-xs"><b className="block text-sm">{walkMin(p.distance_km)} min</b><span className="text-muted">{km(p.distance_km)}</span></span>}
              </PlaceRow>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

export function SafetySection({ r, meta }: { r: MatchResult; meta: Meta }) {
  const l = r.listing
  const yn = (v: boolean | undefined) => (v == null ? null : v ? 'Yes' : 'No')
  const row = 'flex items-center justify-between gap-4 border-b border-line py-2 last:border-0'
  return (
    <Section title="Safety and house rules" id="safety" sign="police">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {([['police', 'Nearest police station', r.nearest_police], ['hospital', 'Nearest hospital or clinic', r.nearest_hospital]] as const).map(([k, label, p]) => (
          <PlaceRow key={k} kind={k} place={p}>
            <SignBadge kind={k} small />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{label}</p>
              <p className="truncate text-xs text-muted"><Fact value={p ? `${km(p.distance_km)}${p.name ? ` · ${p.name}` : ''}` : null} unknown="None mapped within 3 km" /></p>
            </div>
          </PlaceRow>
        ))}
      </div>
      <dl className="text-sm">
        {Object.entries(meta.safety).map(([k, label]) => (
          <div key={k} className={row}><dt>{label}</dt><dd className="font-semibold text-ink"><Fact value={yn(l.safety[k])} /></dd></div>
        ))}
        <div className={row}><dt>Entry curfew</dt><dd className="font-semibold text-ink"><Fact value={l.curfew} /></dd></div>
        <div className={row}><dt>Guests</dt><dd className="text-right font-semibold text-ink"><Fact value={l.guest_policy} /></dd></div>
        <div className={row}><dt>Notice period</dt><dd className="font-semibold text-ink"><Fact value={l.notice_period} /></dd></div>
        <div className={row}><dt>Lock-in</dt><dd className="font-semibold text-ink"><Fact value={l.lock_in} /></dd></div>
      </dl>
    </Section>
  )
}


/** A nearby-place row. When the place is on the map it becomes a button that opens its details card. */
function PlaceRow({ kind, place, className = '', children }: { kind: string; place: NearbyPlace | null | undefined; className?: string; children: ReactNode }) {
  const base = `flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left ${className}`
  if (!place?.poi_id) return <div className={base}>{children}</div>
  const id = place.poi_id
  return (
    <button type="button" className={`${base} transition-colors hover:bg-surface-3`} aria-label={`${place.name ?? kind}: details and contact`}
      onClick={() => openPlace({ id, category: kind, name: place.name, lat: place.lat, lng: place.lng, partial: true })}>
      {children}<ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </button>
  )
}
