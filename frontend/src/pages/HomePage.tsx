import { useNavigate } from 'react-router'
import { PreferenceForm } from '../components/PreferenceForm'
import { ErrorBox, SignBadge, Spinner } from '../components/ui'
import { emptyPreferences, toSearchParams } from '../lib/prefs'
import { lastPreferences, useReference } from '../lib/useReference'

const TILES: { sign: string; title: string; text: string }[] = [
  { sign: 'hostel', title: 'Hostels and PGs', text: 'Rent, mess, travel and electricity added up into one monthly figure.' },
  { sign: 'mess', title: 'Messes nearby', text: 'The kitchen within 1.5 km that serves the most of what you eat.' },
  { sign: 'pharmacy', title: 'Daily needs', text: 'Pharmacy, grocery, xerox and laundry, with walking minutes.' },
  { sign: 'metro', title: 'Getting there', text: 'Walk, cycle, metro, PMPML bus or auto, each with a time and a cost.' },
]

export function HomePage() {
  const ref = useReference()
  const navigate = useNavigate()
  const initial = lastPreferences() ?? emptyPreferences()

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pt-12">
      <div className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] font-semibold text-primary">Pune · PCMC · Hinjewadi · Hadapsar</p>
          <h1 className="text-[42px] font-extrabold sm:text-[56px] lg:text-[64px]">Find a stay that fits your whole day.</h1>
          <p className="max-w-[48ch] text-lg text-muted">
            Tell Nivasa where you study, what you can spend, and how you travel and eat. It ranks hostels and PGs
            across Pune on a real map and tells you why each one fits.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-2">
          {TILES.map((t) => (
            <li key={t.title} className="card flex flex-col gap-3 p-4">
              <SignBadge kind={t.sign} />
              <div>
                <h2 className="text-base">{t.title}</h2>
                <p className="mt-0.5 text-[13.5px] leading-snug text-muted">{t.text}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
          Colleges, metro, shops and over 500 stays are real data for Pune from OpenStreetMap and Overture Maps. Rent and rooms are not on the map, so call or visit to confirm.
        </p>
      </div>

      <div className="card-lg p-5 sm:p-8">
        <h2 className="mb-1 text-[28px] tracking-[-0.03em]">Your preferences</h2>
        <p className="mb-6 text-muted">Takes about a minute. Everything stays in your browser.</p>
        {ref.error && <ErrorBox message={ref.error} onRetry={ref.retry} />}
        {!ref.data && !ref.error && <Spinner label="Loading colleges" />}
        {ref.data && (
          <PreferenceForm initial={initial} meta={ref.data.meta} colleges={ref.data.colleges}
            onSubmit={(p) => navigate(`/results?${toSearchParams(p).toString()}`)} />
        )}
      </div>
    </div>
  )
}
