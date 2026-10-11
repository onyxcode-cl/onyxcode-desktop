import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardia: ningún archivo rastreado por git contiene una llave privada, un token de un servicio conocido o es un archivo de
 * secretos típico (.env, .pem, .p12…). Los valores de ejemplo de las pruebas son más cortos que un token real y no coinciden.
 */
const ROOT = join(__dirname, '..', '..')

const SECRET_FILES =
  /(^|\/)\.env(\..+)?$|\.(pem|p12|pfx|key|keystore)$|(^|\/)id_(rsa|ed25519|ecdsa)$|(^|\/)\.(npmrc|netrc)$|settings\.local\.json$/i
const PATTERNS: Array<[string, RegExp]> = [
  ['llave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['clave de AWS', /AKIA[0-9A-Z]{16}/],
  ['token de GitHub', /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['token de Slack', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['clave de Google', /AIza[0-9A-Za-z_-]{35}/],
  ['clave de Anthropic', /sk-ant-api\d+-[A-Za-z0-9_-]{30,}/],
  ['clave de OpenAI', /sk-(proj-)?[A-Za-z0-9_-]{40,}/]
]

/** Pruebas que NECESITAN tokens de ejemplo (secuencias abcdef…, AKIA…EXAMPLE) para comprobar que la app los oculta. Solo estas. */
const FAKE_TOKEN_TESTS = new Set([
  'src/main/diagnostics/redact.test.ts',
  'src/shared/ai-errors.test.ts',
  'scripts/win/attack/test_attack_suite.py'
])

function tracked(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  return out.split('\0').filter(Boolean)
}

describe('guardia de secretos', () => {
  it('ningún archivo rastreado es de secretos ni contiene una llave o token reales', () => {
    const problems: string[] = []
    for (const f of tracked()) {
      if (SECRET_FILES.test(f)) problems.push(`${f}: archivo de secretos`)
      let size = 0
      try {
        size = statSync(join(ROOT, f)).size
      } catch {
        continue
      }
      if (size > 2 * 1024 * 1024) continue
      let text: string
      try {
        text = readFileSync(join(ROOT, f), 'utf8')
      } catch {
        continue
      }
      if (text.includes('\0') || FAKE_TOKEN_TESTS.has(f)) continue
      for (const [name, re] of PATTERNS) if (re.test(text)) problems.push(`${f}: ${name}`)
    }
    expect(problems.join('\n')).toBe('')
  }, 60_000)
})
