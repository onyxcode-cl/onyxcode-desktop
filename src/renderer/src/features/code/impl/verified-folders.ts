/**
 * Carpetas de confianza ACEPTADAS en esta ejecución (huella igual, nada nuevo, o la persona confirmó). Módulo sin dependencias para que la
 * interfaz (p. ej. Ajustes) pueda preguntar «¿ya pasó la confianza?» antes de pedir algo al motor con una carpeta, sin arrastrar el store de Code.
 */
const verified = new Set<string>()
export const dirId = (d: string): string => d.replace(/[/\\]+$/, '')
export const isFolderVerified = (dir: string): boolean => verified.has(dirId(dir))
export const markVerified = (dir: string): void => void verified.add(dirId(dir))
export const unmarkVerified = (dir: string): void => void verified.delete(dirId(dir))
