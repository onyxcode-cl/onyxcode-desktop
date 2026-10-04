/**
 * Evaluador lang: idioma de la respuesta final (ES/EN) por proporción de stopwords. Determinista, sin LLM.
 * Se ignoran bloques de código, código en línea, URLs, rutas y el marcador/línea de escalada.
 */
import { result, type EvalContext, type EvaluatorResult } from "./types.ts";
import { fold } from "./util.ts";

// Listas sin palabras comunes a ambos idiomas ("a", "no", "me", "es"... se excluyen donde chocan).
export const STOPWORDS_ES = new Set(
  "el la los las un una unos unas de del al y o pero porque como cuando donde que quien cual con sin sobre entre para por hacia desde hasta segun este esta estos estas ese esa eso esto aquel su sus mi mis tu tus nos les le lo se si muy mas menos ya tambien ahora aqui alli hay ser soy eres somos son fue era estoy esta estan estamos tengo tiene tienen hacer hace hizo puedo puede pueden necesito necesita listo carpeta archivo archivos resumen tarea todo todos nada algo otra otro".split(" "),
);
export const STOPWORDS_EN = new Set(
  "the of and to in is are was were be been being it its this that these those with without for from by on at as or but not if then than so such there here i you he she we they me him her us them my your our their have has had do does did done can could will would should may might must what which who whom when where why how all any some no more most other another into over under about after before also just very file files folder summary task ready done need needs needed".split(" "),
);

export function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:~|\.{0,2})\/[\w./-]+/g, " ")
    .replace(/\[\[ONYX:[A-Z_]+\]\]/g, " ");
}

export interface LangScore {
  es: number;
  en: number;
  words: number;
}

export function scoreLang(text: string): LangScore {
  const words = fold(stripNonProse(text)).match(/[a-z]+/g) ?? [];
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (STOPWORDS_ES.has(w)) es++;
    if (STOPWORDS_EN.has(w)) en++;
  }
  return { es, en, words: words.length };
}

/** "es" | "en" | "unknown" (pocas palabras o diferencia insuficiente). */
export function detectLang(text: string, minWords = 8, margin = 1.5): "es" | "en" | "unknown" {
  const s = scoreLang(text);
  if (s.words < minWords) return "unknown";
  if (s.es >= margin * s.en && s.es > 0) return "es";
  if (s.en >= margin * s.es && s.en > 0) return "en";
  return "unknown";
}

export interface LangConfig {
  type: "lang";
  expect: "es" | "en";
  minWords?: number;
}

export function evaluateLang(cfg: LangConfig, ctx: EvalContext): EvaluatorResult {
  const got = detectLang(ctx.finalText, cfg.minWords ?? 8);
  const s = scoreLang(ctx.finalText);
  return result("lang", [{ id: "language", passed: got === cfg.expect, detail: `detectado=${got} (es=${s.es}, en=${s.en}, palabras=${s.words}), esperado=${cfg.expect}` }]);
}
