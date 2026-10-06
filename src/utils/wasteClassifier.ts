import * as tf from '@tensorflow/tfjs'

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
]

let model: tf.GraphModel | null = null
let loadingPromise: Promise<tf.GraphModel> | null = null

async function loadModel() {
  if (model) return model
  if (loadingPromise) return loadingPromise

  loadingPromise = tf.loadGraphModel('/model/model.json')
  model = await loadingPromise
  return model
}

export type ClassificationResult = {
  wasteType: string
  confidence: number
  allScores: { label: string; score: number }[]
}

export async function classifyWasteImage(file: File): Promise<ClassificationResult> {
  const m = await loadModel()

  const imageBitmap = await createImageBitmap(file)

  const prediction = tf.tidy(() => {
    let img = tf.browser.fromPixels(imageBitmap)
    img = tf.image.resizeBilinear(img, [224, 224])
    const normalized = img.toFloat().div(127.5).sub(1)
    const batched = normalized.expandDims(0)
    return m.predict(batched) as tf.Tensor
  })

  const scores = await prediction.data()
  prediction.dispose()

  const allScores = CLASS_NAMES.map((label, i) => ({
    label,
    score: scores[i],
  })).sort((a, b) => b.score - a.score)

  const top = allScores[0]

  return {
    wasteType: top.label,
    confidence: top.score,
    allScores,
  }
}