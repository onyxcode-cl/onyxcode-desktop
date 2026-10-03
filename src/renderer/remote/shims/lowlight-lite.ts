/**
 * `lowlight` de la PWA del celular: `rehype-highlight` importa `{ common, createLowlight }` de `lowlight`; aquí `common` son
 * solo ~15 lenguajes (ver `languages.ts`). `createLowlight` es el original (su `exports` no deja importarlo por subruta).
 */
import { createLowlight } from '../../../../node_modules/lowlight/lib/index.js'
import { LITE_LANGUAGES } from './languages'

export const common = LITE_LANGUAGES
export { createLowlight }
