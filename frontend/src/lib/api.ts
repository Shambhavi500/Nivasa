import type {
  College, GeocodeResult, Listing, MatchResult, Meta, Poi, Preferences, SearchResponse, SubmissionInput, Transit,
} from './types'

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: Record<string, string>
  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

interface FastApiValidationError {
  loc: (string | number)[]
  msg: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'Could not reach the Nivasa server. Check that the backend is running.')
  }
  if (res.ok) return (await res.json()) as T
  let message = `Request failed (${res.status})`
  const fieldErrors: Record<string, string> = {}
  try {
    const body = (await res.json()) as { detail?: string | FastApiValidationError[] }
    if (typeof body.detail === 'string') message = body.detail
    else if (Array.isArray(body.detail)) {
      for (const e of body.detail) {
        const field = e.loc.filter((p) => p !== 'body').join('.')
        fieldErrors[field || 'form'] = e.msg.replace(/^Value error, /, '')
      }
      message = Object.values(fieldErrors)[0] ?? message
    }
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(res.status, message, fieldErrors)
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', body: JSON.stringify(body), signal })

export const api = {
  meta: () => request<Meta>('/meta'),
  colleges: () => request<College[]>('/colleges'),
  transit: () => request<Transit>('/transit'),
  search: (prefs: Preferences, signal?: AbortSignal) => request<SearchResponse>('/search', post(prefs, signal)),
  listing: (id: string) => request<Listing>(`/listings/${encodeURIComponent(id)}`),
  match: (id: string, prefs: Preferences, signal?: AbortSignal) =>
    request<MatchResult>(`/listings/${encodeURIComponent(id)}/match`, post(prefs, signal)),
  report: (id: string, topic: string, message: string) =>
    request<{ status: string }>(`/listings/${encodeURIComponent(id)}/reports`, post({ topic, message })),
  submit: (input: SubmissionInput) => request<{ id: string; message: string }>('/submissions', post(input)),
  geocode: (q: string, signal?: AbortSignal) =>
    request<GeocodeResult[]>(`/geocode?q=${encodeURIComponent(q)}`, { signal }),
  pois: (b: { south: number; west: number; north: number; east: number }, categories: string[], signal?: AbortSignal) =>
    request<Poi[]>(
      `/pois?south=${b.south}&west=${b.west}&north=${b.north}&east=${b.east}&categories=${categories.join(',')}`,
      { signal },
    ),
  poi: (id: string) => request<Poi>(`/pois/${encodeURIComponent(id)}`),
}
