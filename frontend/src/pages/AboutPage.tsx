import { Link } from 'react-router'
import { useReference } from '../lib/useReference'

export function AboutPage() {
  const ref = useReference()
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pb-16 pt-10 sm:px-6 [&_p]:max-w-[68ch] [&_li]:max-w-[68ch] [&_section]:card-lg [&_section]:p-6 sm:[&_section]:p-8">
      <header className="flex flex-col gap-3">
        <span className="text-[15px] font-semibold text-primary">How Nivasa works</span>
        <h1 className="text-[40px] font-extrabold sm:text-[52px]">Ranked around your day, not just the rent</h1>
        <p className="text-lg text-muted">Nivasa scores every stay against your destination, budget, travel, food and must-haves, then explains the result in plain words.</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl tracking-[-0.02em]">The Best-Fit score</h2>
        <p>Six factors are scored out of 100 and averaged using the priorities you set:</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li><b>Budget</b>: the all-in monthly cost (or rent, if you choose) against your budget. Stays more than 15% over are hidden.</li>
          <li><b>Commute</b>: the best trip among your travel modes. Stays beyond your longest trip are hidden.</li>
          <li><b>Food</b>: the one kitchen or mess within 1.5 km that serves the most of what you picked, and how close it is.</li>
          <li><b>Facilities</b>: confirmed amenities, with penalties for missing or unconfirmed must-haves.</li>
          <li><b>Market and essentials</b>: how close the nearest grocery, pharmacy, xerox shop and other daily needs are.</li>
          <li><b>Safety</b>: reported features like CCTV and a warden, plus whether a police station is nearby.</li>
        </ul>
        <p>When a factor has no data, it is left out of the average instead of guessed. The score is then lowered in proportion to the missing weighting (half your weighting unreported means the score is multiplied by 0.75), so a stay that hides its rent cannot outrank one that reports it.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl tracking-[-0.02em]">Costs and travel</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Road distance is estimated as 1.3 × the straight-line distance unless the server is set up with OSRM routing.</li>
          <li>Auto: ₹30 for the first 1.5 km, then ₹20/km (Pune RTA tariff from 1 September 2026).</li>
          <li>PMPML bus: ₹10 up to 5 km, ₹20 up to 10 km; the ₹1,500 monthly pass caps the cost.</li>
          <li>Pune Metro: ₹10–35 by distance with the 30% student concession, on the open Purple and Aqua lines. Line 3 and other stations under construction are shown on the map but not used for routing.</li>
          <li>Food, when not included: about ₹2,900 a month, based on the SPPU member rate of ₹48 a meal for two meals a day. Map data has no mess prices.</li>
          <li>Monthly travel assumes 24 college days and two trips a day.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl tracking-[-0.02em]">Where the data comes from</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {ref.data?.meta.datasets.map((d) => (
            <li key={d.key}><b>{{ colleges: 'Colleges', metro: 'Metro lines and stations', pois: 'Shops, messes, police and hospitals', demo_listings: 'Listings' }[d.key] ?? d.key}</b>: {d.records.toLocaleString('en-IN')} records. {d.source}{d.fetched_at ? `, snapshot ${d.fetched_at.slice(0, 10)}` : ''}.</li>
          ))}
        </ul>
        <p>OpenStreetMap is volunteer-mapped. Small shops and messes are often missing, so "none mapped" never means "none there".</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl tracking-[-0.02em]">Where stays come from</h2>
        <p>Stays are real hostels and PGs in the Pune region from OpenStreetMap and Overture Maps (which carries business listings from Meta and Microsoft). When both list the same stay it appears once. The maps have their name, location and often a phone number, but not rent, rooms or house rules, so those show as "Not reported" and the Best-Fit score counts them as unknown. Some are institute hostels open only to that institute's students. Owners and students can add full details through submissions, which are reviewed before they appear. <Link to="/add-listing" className="font-semibold text-ink underline underline-offset-2">Add a listing</Link>.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl tracking-[-0.02em]">Privacy</h2>
        <p>You don't need an account. Your preferences live in the page address so you can share a search; your saved stays and comparisons are stored only in this browser.</p>
      </section>
    </article>
  )
}

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-[40px] font-extrabold">Page not found</h1>
      <p className="text-muted">That address doesn't match anything in Nivasa.</p>
      <Link to="/" className="btn-primary btn">Find a stay</Link>
    </div>
  )
}
