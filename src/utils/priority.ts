import { CLASS_NAMES, WasteType } from './wasteCategories'

export type PriorityTask = {
  wasteType: string
  amount: string
  date: string
  status: string
}

// Weights (project-design choice, must sum to 1)
export const PRIORITY_WEIGHTS = { urgency: 0.5, age: 0.3, quantity: 0.2 }

export const URGENCY_POLICY: Record<WasteType, number> = {
  battery: 100, 
  biological: 60, 
  'brown-glass': 50,
  'green-glass': 50,
  'white-glass': 50,
  cardboard: 30,
  paper: 30,
  clothes: 20, 
  shoes: 20,
  metal: 50,
  plastic: 40,
  trash: 50, 
}
const DEFAULT_URGENCY = 50

// Aliases for older free-text reports created before the fixed class list
const URGENCY_ALIASES: [keyword: string, score: number][] = [
  ['chemical', 100],
  ['toxic', 100],
  ['hazardous', 100],
  ['medical', 100],
  ['biomedical', 100],
  ['syringe', 100],
  ['hospital', 100],
  ['electronic', 80],
  ['ewaste', 80],
  ['e-waste', 80],
  ['e waste', 80],
  ['organic', 60],
  ['glass', 50],
]

// Configurable bounds
const AGE_MAX_DAYS = 7 // age score reaches 100 after 7 days pending
const QTY_MIN_KG = 1 // at or below -> 0
const QTY_MAX_KG = 50 // at or above -> 100

const clamp = (v: number, min = 0, max = 100) =>
  Number.isNaN(v) ? min : Math.min(max, Math.max(min, v))

export function urgencyScore(wasteType: string): number {
  const t = wasteType.toLowerCase().trim()

  // Fast path: exact match against the model's classes (all new reports).
  // hasOwnProperty avoids false hits on inherited names like "constructor".
  if (Object.prototype.hasOwnProperty.call(URGENCY_POLICY, t)) {
    return URGENCY_POLICY[t as WasteType]
  }

  // Fallback: substring/alias matching for older free-text reports.
  // The highest match wins, so "medical plastic" scores as medical.
  const matches = [
    ...CLASS_NAMES.filter((k) => t.includes(k)).map((k) => URGENCY_POLICY[k]),
    ...URGENCY_ALIASES.filter(([k]) => t.includes(k)).map(([, score]) => score),
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