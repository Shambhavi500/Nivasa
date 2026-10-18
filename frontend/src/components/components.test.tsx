import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { emptyPreferences } from '../lib/prefs'
import { closePlace, openPlace } from '../lib/placeSheet'
import { compareStore } from '../lib/storage'
import { colleges, makeResult, meta } from '../test/fixtures'
import { PlaceSheetHost } from './PlaceSheet'
import { PreferenceForm } from './PreferenceForm'
import { ResultCard } from './ResultCard'
import { ScoreRing } from './ui'

describe('ScoreRing', () => {
  it('labels the score band', () => {
    render(<ScoreRing score={81} />)
    expect(screen.getByLabelText(/Best-Fit score 81 out of 100, Great fit/)).toBeInTheDocument()
  })
  it('says when there is not enough data', () => {
    render(<ScoreRing score={null} />)
    expect(screen.getByText('Not enough data')).toBeInTheDocument()
  })
})

describe('ResultCard', () => {
  const renderCard = (over = {}) =>
    render(<MemoryRouter><ResultCard result={makeResult(over)} meta={meta} destinationLabel="COEP" detailHref="/listings/demo-001" /></MemoryRouter>)

  it('shows the demo label, costs, reasons and warnings', () => {
    renderCard()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getAllByText('₹9,500')).toHaveLength(2) // rent and all-in
    expect(screen.getByText('14-minute walk to COEP')).toBeInTheDocument()
    expect(screen.getByText(/Electricity cost unknown/)).toBeInTheDocument()
    expect(screen.getByText(/Score lowered from 72 because 16% of what you weighted is not reported/)).toBeInTheDocument()
  })

  it('marks unknown rent as not reported instead of a number', () => {
    const r = makeResult()
    renderCard({ cost: { ...r.cost, rent: { amount: null, basis: 'unknown', note: '' }, all_in_known: null } })
    expect(screen.getByText('Not reported')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('adds to compare', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Compare/ }))
    expect(compareStore.get()).toEqual(['demo-001'])
    compareStore.clear()
  })
})

describe('PreferenceForm', () => {
  it('blocks submission until a destination is chosen, then submits', async () => {
    const onSubmit = vi.fn()
    render(<PreferenceForm initial={emptyPreferences()} meta={meta} colleges={colleges} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /Find my stays/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/Choose your college, search an address, or pin a spot/)).toBeInTheDocument()

    const list = screen.getByRole('listbox', { name: 'Colleges' })
    await userEvent.click(within(list).getByText('COEP Technological University'))
    await userEvent.click(screen.getByRole('button', { name: /Find my stays/ }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].destination).toEqual({ college_id: 'coep' })
  })

  it('runs the address search without submitting the whole form', async () => {
    const onSubmit = vi.fn()
    const initial = { ...emptyPreferences(), destination: { college_id: 'coep' } }
    render(<PreferenceForm initial={initial} meta={meta} colleges={colleges} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('tab', { name: /Address/ }))
    await userEvent.type(screen.getByLabelText('Address or landmark'), 'ab{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText('Type at least 3 characters.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('requires at least one travel mode', async () => {
    const onSubmit = vi.fn()
    const initial = { ...emptyPreferences(), destination: { college_id: 'coep' }, modes: ['walk' as const] }
    render(<PreferenceForm initial={initial} meta={meta} colleges={colleges} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Walk' }))
    await userEvent.click(screen.getByRole('button', { name: /Find my stays/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Pick at least one way to get to college.')).toBeInTheDocument()
  })
})

describe('PlaceSheetHost', () => {
  it('shows a hospital with call, emergency, email and website links, and closes on Escape', async () => {
    render(<PlaceSheetHost />)
    act(() => openPlace({
      id: 'w331500153', category: 'hospital', name: 'Jehangir Hospital', lat: 18.53, lng: 73.877,
      phone: '+91 20 6681 9966; +91 20 6681 8890', email: 'info@jehangirhospital.com', website: 'https://www.jehangirhospital.com',
      address: '32 Sassoon Road, Pune', details: { emergency: 'yes', emergency_phone: '+91 88888 81066' }, contact_source: 'official site',
    }))
    const dialog = screen.getByRole('dialog', { name: 'Jehangir Hospital' })
    expect(within(dialog).getByRole('link', { name: /Call \+91 20 6681 9966/ })).toHaveAttribute('href', 'tel:+912066819966')
    expect(within(dialog).getByRole('link', { name: /Call \+91 20 6681 8890/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Emergency: \+91 88888 81066/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /info@jehangirhospital.com/ })).toHaveAttribute('href', 'mailto:info@jehangirhospital.com')
    expect(within(dialog).getByText('Emergency department')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says when a mess has no mapped contact', () => {
    render(<PlaceSheetHost />)
    act(() => openPlace({ id: 'n1', category: 'mess', name: 'Kaku Chi Mess', lat: 18.5, lng: 73.8, cuisine: ['maharashtrian'], pure_veg: true }))
    expect(screen.getByText(/No phone number or email is mapped/)).toBeInTheDocument()
    expect(screen.getByText('Pure veg')).toBeInTheDocument()
    act(() => closePlace())
  })
})
