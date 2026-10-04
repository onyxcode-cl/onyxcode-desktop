/**
 * Patrones de escalada «sandbox -> Control total» replicados COMO DATOS de OnyxCode.
 *
 * FUENTE (solo lectura, no se importa en tiempo de ejecución):
 *   /Users/ben/Documents/App OpenCode/src/renderer/src/features/tasks/impl/EscalateCard.tsx
 *   (constantes ESCALATE_MARKER y PHRASES, función needsFullAccess/foldWithMap) @ OnyxCode fc05b77.
 *   Botón citado en español en resources/opencode/agents/tasks.md; en inglés vía
 *   src/shared/tasks-prompt.ts (QUOTED_BUTTONS) y src/shared/i18n: 'tasksComputer.escalate.switch'.
 *
 * Si OnyxCode cambia esos patrones, actualizar este archivo (el test de escalación fija los valores actuales).
 */
export const ESCALATE_MARKER = "[[ONYX:NEEDS_FULL_CONTROL]]";

/** Frases (ya sin tildes y en minúsculas) que la tarjeta de OnyxCode reconoce. */
export const ESCALATE_PHRASES = [
  "necesita control total del mac",
  "needs full mac control",
  "needs full control of the mac",
  "needs full control of your mac",
] as const;

/** Línea literal que pide el prompt del agente tasks (es) y su variante con interfaz en inglés. */
export const ESCALATE_LINE_PREFIX = { es: "**Necesita Control total del Mac**:", en: "**Needs Full Mac control**:" } as const;

/** Botón que el agente debe nombrar justo antes de la línea de escalada. */
export const ESCALATE_BUTTON = { es: "Cambiar a Control total y continuar", en: "Switch to Full Mac control and continue" } as const;

/** Réplica de needsFullAccess (plegado: minúsculas + NFD sin marcas diacríticas). */
export function needsFullAccess(text: string): boolean {
  const folded = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return folded.includes(ESCALATE_MARKER.toLowerCase()) || ESCALATE_PHRASES.some((p) => folded.includes(p));
}
