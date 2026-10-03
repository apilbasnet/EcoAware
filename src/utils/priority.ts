import { WASTE_TYPES, WasteType } from './Wastecategories'

export type PriorityTask = {
  wasteType: string
  amount: string
  date: string
  status: string
}

// Weights (project-design choice, must sum to 1)
export const PRIORITY_WEIGHTS = { urgency: 0.5, age: 0.3, quantity: 0.2 }

// Operational policy: urgency per waste category (0-100)
export const URGENCY_POLICY: Record<WasteType, number> = {
  hazardous: 100,
  medical: 100,
  'e-waste': 80,
  organic: 60,
  metal: 50,
  glass: 50,
  plastic: 40,
  paper: 30,
}
const DEFAULT_URGENCY = 50

// Aliases so older free-text reports (before categories were fixed) still map correctly
const URGENCY_ALIASES: [keyword: string, category: WasteType][] = [
  ['chemical', 'hazardous'],
  ['toxic', 'hazardous'],
  ['battery', 'hazardous'],
  ['biomedical', 'medical'],
  ['syringe', 'medical'],
  ['hospital', 'medical'],
  ['electronic', 'e-waste'],
  ['ewaste', 'e-waste'],
  ['e waste', 'e-waste'],
]

// Configurable bounds
const AGE_MAX_DAYS = 7 // age score reaches 100 after 7 days pending
const QTY_MIN_KG = 1 // at or below -> 0
const QTY_MAX_KG = 50 // at or above -> 100

const clamp = (v: number, min = 0, max = 100) =>
  Number.isNaN(v) ? min : Math.min(max, Math.max(min, v))

export function urgencyScore(wasteType: string): number {
  const t = wasteType.toLowerCase()
  const matches = [
    ...WASTE_TYPES.filter(k => t.includes(k)).map(k => URGENCY_POLICY[k]),
    ...URGENCY_ALIASES.filter(([k]) => t.includes(k)).map(([, c]) => URGENCY_POLICY[c]),
  ]
  return matches.length ? Math.max(...matches) : DEFAULT_URGENCY
}

export function ageScore(date: string, now = new Date()): number {
  const created = new Date(date)
  if (isNaN(created.getTime())) return 0
  const days = (now.getTime() - created.getTime()) / 86_400_000
  return clamp((days / AGE_MAX_DAYS) * 100)
}

export function parseKg(amount: string): number {
  const m = amount
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*([a-z]+)?/)
  if (!m) return 0
  const lo = parseFloat(m[1])
  const hi = m[2] ? parseFloat(m[2]) : lo
  const n = (lo + hi) / 2 // ranges use the midpoint
  const unit = m[3] ?? 'kg'
  if (/^(g|grams?)$/.test(unit)) return n / 1000
  if (/^(tons?|tonnes?)$/.test(unit)) return n * 1000
  if (/^(lbs?|pounds?)$/.test(unit)) return n * 0.4536
  return n // kg, liters, anything else: treated as kg
}

export function quantityScore(amount: string): number {
  const kg = parseKg(amount)
  return clamp(((kg - QTY_MIN_KG) / (QTY_MAX_KG - QTY_MIN_KG)) * 100)
}

export function priorityScore(task: PriorityTask) {
  const urgency = urgencyScore(task.wasteType)
  const age = ageScore(task.date)
  const quantity = quantityScore(task.amount)
  const score =
    PRIORITY_WEIGHTS.urgency * urgency +
    PRIORITY_WEIGHTS.age * age +
    PRIORITY_WEIGHTS.quantity * quantity
  return { score: Math.round(score * 10) / 10, urgency, age, quantity }
}

export function priorityLabel(score: number) {
  if (score >= 70) return { text: 'High', color: 'bg-red-100 text-red-800' }
  if (score >= 40) return { text: 'Medium', color: 'bg-orange-100 text-orange-800' }
  return { text: 'Low', color: 'bg-gray-100 text-gray-700' }
}