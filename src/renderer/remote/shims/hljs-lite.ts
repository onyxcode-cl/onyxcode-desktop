/** `highlight.js/lib/common` de la PWA del celular, limitado a unos 15 lenguajes (ver `languages.ts`). */
import hljs from 'highlight.js/lib/core'
import { LITE_LANGUAGES } from './languages'

for (const [name, fn] of Object.entries(LITE_LANGUAGES)) hljs.registerLanguage(name, fn)

export default hljs
