import { Bookmark, BookmarkCheck, Check, CircleAlert, Scale } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { inr, km } from '../lib/format'
import { COMPARE_MAX, compareStore, savedStore, useIds } from '../lib/storage'
import type { MatchResult, Meta } from '../lib/types'
import { Glyph, ScoreRing, SignBadge } from './ui'

interface Props {
  result: MatchResult
  meta: Meta
  destinationLabel: string
  detailHref: string
  selected?: boolean
  onSelect?: () => void
  onNotice?: (msg: string) => void
}

export function ListingBadges({ result, meta }: { result: MatchResult; meta: Meta }) {
  const l = result.listing
  return (
    <div className="flex flex-wrap gap-1.5">
      {l.is_demo && <span className="badge badge-demo" title="Fictional listing for development">Demo</span>}
      {l.id.startsWith('osm-') && <span className="badge badge-ok" title="A real place mapped on OpenStreetMap. Rent and rooms are not reported.">Real · OpenStreetMap</span>}
      {l.contact_phone && !l.is_demo && <span className="badge">Has phone</span>}
      <span className="badge">{meta.stay_types[l.stay_type]}</span>
      <span className="badge">{l.gender ? meta.genders[l.gender] : 'Boys/girls not reported'}</span>
      {l.verification_status === 'visit_verified' && <span className="badge badge-ok">Visit-verified</span>}
      {l.available_beds === 0 && <span className="badge badge-warn">Full</span>}
      {l.available_beds != null && l.available_beds > 0 && <span className="badge">{l.available_beds} bed{l.available_beds > 1 ? 's' : ''} free</span>}
    </div>
  )
}

function Stat({ label, sign, value, sub, tone }: { label: string; sign?: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-xs font-semibold text-muted">{sign && <Glyph kind={sign} size={13} />}{label}</dt>
      <dd className={`num text-[15px] font-bold ${tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</dd>
      {sub && <dd className="line-clamp-1 text-xs text-muted">{sub}</dd>}
    </div>
  )
}

export function ResultCard({ result, meta, destinationLabel, detailHref, selected, onSelect, onNotice }: Props) {
  const l = result.listing
  const saved = useIds(savedStore).includes(l.id)
  const inCompare = useIds(compareStore).includes(l.id)
  const rec = result.commute.recommended
  const c = result.cost
  const food = result.food[0]
  const unknown = (text: string) => <span className="font-normal italic text-faint">{text}</span>

  return (
    <article
      className={`card flex flex-col gap-4 p-4 transition-[box-shadow,background-color] sm:p-5 ${onSelect ? 'cursor-pointer' : ''} ${selected ? 'bg-surface shadow-[0_0_0_2px_var(--ink)]' : onSelect ? 'hover:bg-surface-3/50' : ''}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) onSelect?.() }}
      aria-current={selected || undefined}
      data-listing={l.id}>
      <div className="flex items-start gap-3">
        <SignBadge kind={l.stay_type} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-[17px] leading-snug tracking-[-0.01em]"><Link to={detailHref} className="hover:underline underline-offset-4">{l.name}</Link></h3>
          <p className="text-[13px] text-muted">{l.area} · {km(result.commute.straight_km)} from {destinationLabel} (straight line)</p>
        </div>
        <ScoreRing score={result.score} />
      </div>
      <ListingBadges result={result} meta={meta} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl bg-surface p-3.5 sm:grid-cols-4">
        <Stat label="Rent" value={c.rent.amount != null ? inr(c.rent.amount) : unknown('Not reported')} sub={c.sharing ? meta.sharing[c.sharing] : undefined} />
        <Stat label="All-in" tone={c.difference != null && c.difference < 0 ? 'bad' : undefined}
          value={c.all_in_known != null ? inr(c.all_in_known) : unknown('Unknown')}
          sub={c.unknown_parts.length && c.all_in_known != null ? `+ ${c.unknown_parts.join(', ')} unknown` : 'per month'} />
        <Stat label="To college" sign={rec?.mode} value={rec ? `${rec.minutes} min` : 'n/a'} sub={rec ? rec.label : 'No option'} />
        <Stat label="Food" sign="mess"
          value={l.food_included ? 'Included' : food ? km(food.distance_km) : unknown('No mess mapped')}
          sub={l.food_included ? l.meals ?? 'meals' : food ? food.name : 'nearby'} />
      </dl>

      <ul className="flex flex-col gap-1.5 text-sm">
        {result.reasons.slice(0, 3).map((r) => (
          <li key={r} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />{r}</li>
        ))}
        {result.warnings.slice(0, 3).map((w) => (
          <li key={w} className="flex gap-2 text-muted"><CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /><span><span className="sr-only">Note: </span>{w}</span></li>
        ))}
      </ul>
      {result.score_coverage < 1 && (
        <p className="text-xs text-muted">Score lowered from {result.assessed_score} because {100 - Math.round(result.score_coverage * 100)}% of what you weighted is not reported for this stay.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link to={detailHref} className="btn-primary btn">View details</Link>
        <button type="button" className="btn" aria-pressed={saved} onClick={() => { savedStore.toggle(l.id); onNotice?.(saved ? 'Removed from saved' : 'Saved') }}>
          {saved ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}{saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className="btn" aria-pressed={inCompare} onClick={() => {
          const ok = compareStore.toggle(l.id)
          onNotice?.(!ok ? `Compare holds ${COMPARE_MAX} stays. Remove one first.` : inCompare ? 'Removed from compare' : 'Added to compare')
        }}>
          <Scale className="size-4" aria-hidden />{inCompare ? 'In compare' : 'Compare'}
        </button>
      </div>
    </article>
  )
}
