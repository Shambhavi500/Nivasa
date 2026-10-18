import { useSyncExternalStore } from 'react'
import type { Poi } from './types'

/**
 * Which place card is open. Any marker or list row can open one with `openPlace`; a single
 * <PlaceSheetHost> in the layout renders it. Pass a full Poi when you have it, or just its id
 * (with a name and position to show while the details load).
 */
export type PlaceRef = Poi | { id: string; category: string; name: string | null; lat: number; lng: number; partial: true }

let current: PlaceRef | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openPlace(place: PlaceRef) {
  current = place
  emit()
}

export function closePlace() {
  current = null
  emit()
}

export function usePlaceSheet(): PlaceRef | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => current,
    () => null,
  )
}
