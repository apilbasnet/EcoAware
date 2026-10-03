import { GoogleGenAI } from "@google/genai";

const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.6-flash",
];


type GenerateParams = Parameters<GoogleGenAI["models"]["generateContent"]>[0];

export function isQuotaError(e: unknown): boolean {
  const err = e as any;
  return (
    err?.status === 429 ||
    /RESOURCE_EXHAUSTED|"code":\s*429/.test(String(err?.message ?? err))
  );
}

export async function generateWithFallback(
  ai: GoogleGenAI,
  params: Omit<GenerateParams, "model">,
) {
  let lastError: unknown;
  for (const model of MODELS) {
    try {
      return await ai.models.generateContent({ ...params, model });
    } catch (e) {
      lastError = e;
      if (!isQuotaError(e)) throw e; 
    }
  }
  throw lastError;
}