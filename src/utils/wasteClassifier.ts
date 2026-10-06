import * as tf from '@tensorflow/tfjs'
import { CLASS_NAMES } from './wasteCategories'

export { CLASS_NAMES }

// Tune these with real photos from your area.
export const MIN_CONFIDENCE = 0.6 // top class must be at least this likely
export const MIN_MARGIN = 0.2 // and at least this far ahead of the runner-up

// Cache the promise (not the model) so concurrent calls share one load,
// and clear it on failure so the next click can retry.
let modelPromise: Promise<tf.GraphModel> | null = null

function loadModel(): Promise<tf.GraphModel> {
  if (!modelPromise) {
    modelPromise = tf.loadGraphModel('/model/model.json').catch((err) => {
      modelPromise = null
      throw err
    })
  }
  return modelPromise
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

export type ClassificationResult = {
  wasteType: string
  confidence: number
  margin: number // top score minus second-best score
  allScores: { label: string; score: number }[]
}

export async function classifyWasteImage(file: File): Promise<ClassificationResult> {
  const m = await loadModel()
  const imageBitmap = await createImageBitmap(file)

  let prediction: tf.Tensor
  try {
    prediction = tf.tidy(() => {
      const img = tf.browser.fromPixels(imageBitmap)
      const resized = tf.image.resizeBilinear(img, [224, 224])
      // Must match how the model was trained (here: scale to [-1, 1]).
      const normalized = resized.toFloat().div(127.5).sub(1)
      return m.predict(normalized.expandDims(0)) as tf.Tensor
    })
  } finally {
    imageBitmap.close()
  }

  let scores = Array.from(await prediction.data())
  prediction.dispose()

  if (scores.length !== CLASS_NAMES.length) {
    throw new Error(
      `Model returned ${scores.length} scores but CLASS_NAMES has ${CLASS_NAMES.length} entries`,
    )
  }

  // If the model outputs raw logits instead of probabilities, convert them.
  const sum = scores.reduce((a, b) => a + b, 0)
  if (scores.some((s) => s < 0) || Math.abs(sum - 1) > 0.01) {
    scores = softmax(scores)
  }

  const allScores = CLASS_NAMES.map((label, i) => ({ label: label as string, score: scores[i] })).sort(
    (a, b) => b.score - a.score,
  )

  return {
    wasteType: allScores[0].label,
    confidence: allScores[0].score,
    margin: allScores[0].score - allScores[1].score,
    allScores,
  }
}