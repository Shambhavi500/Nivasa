// Mirrors backend/app/schemas.py. Keep the two in sync.

export type StayType = 'hostel' | 'pg' | 'flat'
export type Gender = 'boys' | 'girls' | 'coed'
export type Sharing = 'single' | 'double' | 'triple' | 'quad'
export type Mode = 'walk' | 'cycle' | 'two_wheeler' | 'metro' | 'bus' | 'auto'
export type Diet = 'veg' | 'nonveg' | 'jain'
export type FactorKey = 'budget' | 'commute' | 'food' | 'facilities' | 'market' | 'safety'
export type Weights = Record<FactorKey, number>

export interface Destination {
  college_id?: string | null
  lat?: number | null
  lng?: number | null
  label?: string | null
}

export interface Preferences {
  destination: Destination
  budget: number
  budget_mode: 'all_in' | 'rent'
  gender: 'boys' | 'girls'
  stay_types: StayType[]
  sharing: 'any' | 'single' | 'double' | 'triple'
  modes: Mode[]
  max_commute_min: number
  diet: Diet
  pure_veg_only: boolean
  cuisines: string[]
  must_haves: string[]
  weights: Weights
}

export interface College {
  id: string
  name: string
  short_name: string
  area: string
  lat: number
  lng: number
  osm_ref: string | null
}

export interface Room {
  sharing: Sharing
  monthly_rent: number | null
}

export interface Listing {
  id: string
  name: string
  stay_type: StayType
  gender: Gender | null
  area: string
  address: string | null
  lat: number
  lng: number
  location_precision: string
  description: string | null
  rooms: Room[]
  food_included: boolean | null
  meals: string | null
  kitchen_cuisines: string[] | null
  kitchen_pure_veg: boolean | null
  electricity_included: boolean | null
  electricity_estimate: number | null
  deposit: number | null
  notice_period: string | null
  lock_in: string | null
  curfew: string | null
  guest_policy: string | null
  available_beds: number | null
  amenities: Record<string, boolean>
  safety: Record<string, boolean>
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_website?: string | null
  is_demo: boolean
  verification_status: 'unverified' | 'owner_submitted' | 'visit_verified'
  verified_on: string | null
  data_source: string
}

export interface Factor {
  key: FactorKey
  label: string
  weight: number
  score: number | null
  detail: string
}

export interface CostLine {
  amount: number | null
  basis: 'reported' | 'included' | 'estimate' | 'unknown' | 'not_needed'
  note: string
}

export interface CostBreakdown {
  rent: CostLine
  sharing: Sharing | null
  food: CostLine
  travel: CostLine
  electricity: CostLine
  all_in_known: number | null
  unknown_parts: string[]
  budget: number
  budget_mode: 'all_in' | 'rent'
  compared_amount: number | null
  difference: number | null
}

export interface ModeOption {
  mode: Mode
  label: string
  available: boolean
  in_preferences: boolean
  minutes: number | null
  monthly_cost: number | null
  per_trip_cost: number | null
  note: string
}

export interface Commute {
  distance_km: number
  straight_km: number
  routing_source: string
  recommended: ModeOption | null
  within_limit: boolean
  options: ModeOption[]
}

export interface FoodOption {
  kind: 'in_house' | 'mess'
  name: string
  poi_id: string | null
  lat: number | null
  lng: number | null
  distance_km: number
  cuisines: string[] | null
  matched: string[]
  coverage: number | null
  pure_veg: boolean | null
  jain: boolean | null
  opening_hours: string | null
}

export interface NearbyPlace {
  poi_id?: string | null
  name: string | null
  distance_km: number
  lat: number
  lng: number
}

export interface MatchResult {
  listing: Listing
  score: number | null
  /** Average of the factors that could be assessed, before the missing-data reduction. */
  assessed_score: number | null
  score_coverage: number
  factors: Factor[]
  cost: CostBreakdown
  commute: Commute
  food: FoodOption[]
  essentials: { by_category: Record<string, NearbyPlace | null>; within_walk: number; categories_total: number }
  nearest_police: NearbyPlace | null
  nearest_hospital: NearbyPlace | null
  reasons: string[]
  warnings: string[]
  hidden_reasons: string[]
}

export interface HiddenListing {
  id: string
  name: string
  lat: number
  lng: number
  reasons: string[]
}

export interface ResolvedDestination {
  label: string
  short_label: string
  lat: number
  lng: number
  college_id: string | null
}

export interface SearchResponse {
  destination: ResolvedDestination
  results: MatchResult[]
  hidden: HiddenListing[]
  hidden_counts: Record<string, number>
  budget_suggestion: { budget: number; extra_results: number } | null
  total_considered: number
  includes_demo: boolean
  data_notice: string
}

export interface Meta {
  stay_types: Record<StayType, string>
  genders: Record<Gender, string>
  sharing: Record<Sharing, string>
  modes: Record<Mode, string>
  diets: Record<Diet, string>
  cuisines: string[]
  amenities: Record<string, string>
  safety: Record<string, string>
  essentials: Record<string, string>
  factors: Record<FactorKey, string>
  default_weights: Weights
  region_bounds: [number, number, number, number]
  datasets: { key: string; source: string; fetched_at: string | null; records: number }[]
  geocoder_enabled: boolean
  routing_provider: string
}

export interface Poi {
  id: string
  category: string
  name: string | null
  lat: number
  lng: number
  cuisine?: string[] | null
  pure_veg?: boolean | null
  jain?: boolean | null
  opening_hours?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  address?: string | null
  /** Extra mapped facts: speciality, emergency, operator, emergency_phone, name_mr ... Missing keys are unknown. */
  details?: Record<string, string> | null
  contact_source?: string | null
}

export interface Transit {
  lines: { id: string; name: string; colour: string | null; stops: { name: string; lat: number; lng: number }[] }[]
  stations: { id: string; name: string; lat: number; lng: number; status: string }[]
  source: string
}

export interface GeocodeResult {
  label: string
  short_label: string
  lat: number
  lng: number
  source: string
}

export interface SubmissionInput {
  name: string
  stay_type: StayType
  gender: Gender | null
  area: string
  address: string | null
  lat: number
  lng: number
  rooms: Room[]
  food_included: boolean | null
  amenities: Record<string, boolean>
  contact_name: string | null
  contact_phone: string | null
  notes: string | null
}
