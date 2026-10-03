/** Trozo con el diccionario inglés real; llena el objeto vacío del shim `en-lazy.ts` (misma referencia que `DICTIONARIES.en`). */
import { DICTIONARIES } from '@shared/i18n'
import { en } from '@shared/i18n/en/index'

let done = false

export const englishInstalled = (): boolean => done

export function installEnglish(): void {
  if (done) return
  done = true
  Object.assign(DICTIONARIES.en, en)
}
