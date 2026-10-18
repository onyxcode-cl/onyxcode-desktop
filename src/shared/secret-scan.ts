/**
 * Detección de secretos en lo que está a punto de subirse (módulo PURO). Mismos patrones de alta confianza que la guardia
 * `src/test/no-secrets.test.ts`: solo avisan del TIPO, nunca devuelven el valor encontrado.
 */
export type SecretKind = 'private-key' | 'aws-key' | 'github-token' | 'slack-token' | 'google-key' | 'anthropic-key' | 'openai-key'

const PATTERNS: Array<[SecretKind, RegExp]> = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-key', /AKIA[0-9A-Z]{16}/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['google-key', /AIza[0-9A-Za-z_-]{35}/],
  ['anthropic-key', /sk-ant-api\d+-[A-Za-z0-9_-]{30,}/],
  ['openai-key', /sk-(proj-)?[A-Za-z0-9_-]{40,}/]
]

/** Tipos de secreto que aparecen en `text` (sin repetir, sin valores). */
export function scanSecretKinds(text: string): SecretKind[] {
  const out: SecretKind[] = []
  for (const [kind, re] of PATTERNS) if (re.test(text) && !out.includes(kind)) out.push(kind)
  return out
}

/**
 * Recorre un diff unificado y devuelve, por archivo, los tipos de secreto hallados en las líneas AÑADIDAS (`+`).
 * Las líneas de contexto o borradas no cuentan: un secreto que se elimina no se sube.
 */
export function scanDiffAdded(diff: string): Array<{ file: string; kinds: SecretKind[] }> {
  const found = new Map<string, Set<SecretKind>>()
  let file = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line)
      file = m ? m[1] : ''
      continue
    }
    if (line.startsWith('+++ ')) {
      const m = /^\+\+\+ b\/(.+)$/.exec(line)
      if (m) file = m[1]
      continue
    }
    if (!line.startsWith('+')) continue
    const kinds = scanSecretKinds(line.slice(1))
    if (kinds.length === 0) continue
    const set = found.get(file) ?? new Set<SecretKind>()
    kinds.forEach((k) => set.add(k))
    found.set(file, set)
  }
  return [...found].map(([f, k]) => ({ file: f, kinds: [...k] }))
}
