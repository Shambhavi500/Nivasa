import { Menu, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { compareStore, savedStore, useIds } from '../lib/storage'
import { PlaceSheetHost } from './PlaceSheet'

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="10" fill="var(--primary)" />
      <path d="M7.5 15.6 16 8.6l8.5 7V24a.8.8 0 0 1-.8.8h-4.9v-5.3h-5.6v5.3H8.3a.8.8 0 0 1-.8-.8z" fill="var(--on-primary)" />
    </svg>
  )
}

export function Layout() {
  const saved = useIds(savedStore)
  const compare = useIds(compareStore)
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const fullBleed = pathname.startsWith('/results')
  const searching = pathname === '/' || pathname.startsWith('/results') || pathname.startsWith('/listings')

  const link = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-4 min-h-10 text-[15px] font-semibold transition-colors ${active ? 'bg-ink text-on-ink' : 'text-ink hover:bg-surface-2'}`
  const navClass = ({ isActive }: { isActive: boolean }) => link(isActive)
  const count = (n: number) => (n ? <span className="num rounded-full bg-primary px-1.5 text-xs leading-5 text-on-primary">{n}</span> : null)

  return (
    <div className={`flex flex-col ${fullBleed ? 'lg:h-full' : 'min-h-full'}`}>
      <a href="#main" className="btn sr-only z-[1000] focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Skip to content</a>
      <header className={`sticky top-0 z-[500] bg-surface ${pathname === '/' ? '' : 'border-b border-line'}`}>
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2 rounded-xl" aria-label="Nivasa home" onClick={() => setOpen(false)}>
            <Logo />
            <span className="text-[22px] font-extrabold tracking-[-0.04em] text-ink">nivasa</span>
          </NavLink>
          <span className="ml-1 hidden text-sm text-muted xl:inline">Student stays across Pune</span>
          <button className="btn-ghost btn btn-icon ml-auto md:hidden" aria-expanded={open} aria-controls="nav" onClick={() => setOpen((o) => !o)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}<span className="sr-only">Menu</span>
          </button>
          <nav id="nav" aria-label="Main"
            className={`${open ? 'flex' : 'hidden'} absolute left-0 right-0 top-full flex-col gap-1 border-b border-line bg-surface p-3 md:static md:ml-auto md:flex md:flex-row md:items-center md:border-0 md:p-0`}
            onClick={() => setOpen(false)}>
            <NavLink to="/" className={() => link(searching)}>Find a stay</NavLink>
            <NavLink to="/saved" className={navClass}>Saved{count(saved.length)}</NavLink>
            <NavLink to="/compare" className={navClass}>Compare{count(compare.length)}</NavLink>
            <NavLink to="/about" className={navClass}>How it works</NavLink>
            <NavLink to="/add-listing" className="btn-primary btn mt-2 md:ml-2 md:mt-0"><Plus className="size-4" aria-hidden />Add a listing</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className={fullBleed ? 'min-h-0 flex-1' : 'flex-1'}>
        <Outlet />
      </main>
      <PlaceSheetHost />
      {!fullBleed && (
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span className="flex items-center gap-2"><b className="font-extrabold tracking-[-0.03em]">nivasa</b> Built for students moving to Pune.</span>
            <span>
              Map data © <a className="underline underline-offset-2 hover:text-ink" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.
              {' '}Commute times and costs are estimates. Stays come from OpenStreetMap, Overture Maps and owner submissions.
            </span>
          </div>
        </footer>
      )}
    </div>
  )
}
