
export const WASTE_TYPES = [
  'plastic',
  'paper',
  'glass',
  'metal',
  'organic',
  'e-waste',
  'hazardous',
  'medical',
] as const

export type WasteType = (typeof WASTE_TYPES)[number]