/**
 * `true` SOLO en un build de prueba (`LAZUNOX_TEST_BUILD=1 npm run package`, ver docs/DISTRIBUCION.md §11).
 * Se sustituye en compilación (electron.vite.config.ts): un build normal lo deja en `false` y el código
 * que depende de esto desaparece. Sin compilar (vitest, dev) es `false`.
 */
declare const __LAZUNOX_TEST_BUILD__: boolean | undefined
export const IS_TEST_BUILD: boolean = typeof __LAZUNOX_TEST_BUILD__ !== 'undefined' && __LAZUNOX_TEST_BUILD__ === true
