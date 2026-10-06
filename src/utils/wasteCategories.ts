
export const CLASS_NAMES = [
  'battery',
  'biological',
  'brown-glass',
  'cardboard',
  'clothes',
  'green-glass',
  'metal',
  'paper',
  'plastic',
  'shoes',
  'trash',
  'white-glass',
] as const

export type WasteType = (typeof CLASS_NAMES)[number]