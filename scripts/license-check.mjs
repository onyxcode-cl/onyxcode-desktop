// Coherencia entre `LICENSE` y `THIRD_PARTY_NOTICES.md` (lo usa verify-release.mjs). No decide ninguna licencia: solo detecta contradicciones.
/** Nombre SPDX de la licencia de un `LICENSE`, o null si no se reconoce. */
export function detectLicense(text) {
  if (/^\s*MIT License\b/i.test(text) && /Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/Apache License\s*\n?\s*Version 2\.0/i.test(text)) return 'Apache-2.0'
  return null
}

/** Devuelve la lista de contradicciones (vacía si todo cuadra). */
export function checkLicenseCoherence(license, notices) {
  const errors = []
  if (/LICENCIA PENDIENTE/i.test(license)) errors.push('LICENSE contiene «LICENCIA PENDIENTE»')
  if (/LICENCIA PROPIA DE LAZUNOX:\s*\**\s*PENDIENTE/i.test(notices))
    errors.push('THIRD_PARTY_NOTICES.md dice que la licencia propia está PENDIENTE pero existe LICENSE: alinea el texto')
  const kind = detectLicense(license)
  if (!kind) errors.push('No se reconoce la licencia de LICENSE (se esperaba MIT o Apache-2.0): revísala')
  const line = /^\*\*Licencia de Lazunox:?\s*([^*\n]*)\.?\*\*[^\n]*$/m.exec(notices)
  if (!line) errors.push('THIRD_PARTY_NOTICES.md no declara la licencia de Lazunox (línea «**Licencia de Lazunox: …**»)')
  else if (kind && line[1].trim().replace(/\.$/, '') !== kind)
    errors.push(`THIRD_PARTY_NOTICES.md declara «${line[1].trim().replace(/\.$/, '')}» pero LICENSE es ${kind}`)
  else if (!/`LICENSE`/.test(line[0])) errors.push('La declaración de licencia de THIRD_PARTY_NOTICES.md debe remitir al fichero `LICENSE`')
  return errors
}
