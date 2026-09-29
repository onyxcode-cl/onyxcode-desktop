import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardia: el texto visible (y los prompts/agentes) no debe nombrar productos de terceros.
 * Los identificadores internos (useCowork, HtmlArtifact, 'cowork:*'…) no cuentan porque la
 * detección es sensible a MAYÚSCULA inicial y exige que no haya \w o $ pegado al término.
 */

const ROOT = resolve(__dirname, '../..')
const DIRS = ['src/renderer', 'src/main', 'src/shared', 'src/preload', 'resources/opencode']
const EXTS = ['.ts', '.tsx', '.md']

interface Rule {
  id: string
  re: RegExp
  /** Aplicar la regex solo al contenido de los literales de cadena de la línea */
  inStrings?: boolean
}

const RULES: Rule[] = [
  { id: 'Cowork', re: /(?<![\w$])Cowork(?![\w$])/ },
  { id: 'Artifact', re: /(?<![\w$])Artifacts?(?![\w$])/ },
  // Se evalúa solo dentro de literales de cadena completos (ver `stringLiterals`).
  { id: 'artifact-en-comillas', re: / artifact/, inStrings: true },
  { id: 'Teach-mode', re: /Teach mode|Modo Teach/i },
  { id: 'computer-use', re: /computer use/i },
  { id: 'Dispatch', re: /\bDispatch\b/ },
  { id: 'Claude|Anthropic', re: /Claude|Anthropic/ }
]

interface Exception {
  /** Ruta relativa al repo, o prefijo/patrón simple con `*` */
  file: string
  rule: string
  /** Solo se exime si la línea coincide con este patrón */
  line: RegExp
  reason: string
}

const EXCEPTIONS: Exception[] = [
  {
    file: '*',
    rule: 'artifact-en-comillas',
    line: /-artifact|['"`]artifact['"`]/,
    reason: 'Protocolo `${APP_SLUG}-artifact:` y partición `artifact`: contrato interno persistente.'
  },
  {
    file: '*',
    rule: 'Artifact',
    line: /extras:openArtifact/,
    reason: 'Canal IPC `extras:openArtifact`: contrato interno (allowlists y esquemas).'
  },
  {
    file: 'src/renderer/src/features/settings/impl/AboutSection.tsx',
    rule: 'Claude|Anthropic',
    line: /no afiliado a OpenCode ni a Anthropic/,
    reason: 'Aviso legal de Acerca de: debe nombrar a Anthropic para desvincularse.'
  },
  {
    file: 'src/main/cowork/sandbox-profile.ts',
    rule: 'Cowork',
    line: /;; Red: denegada/,
    reason: 'Perfil Seatbelt (SBPL): su texto no se muestra ni se toca (ver plan: no modificar).'
  },
  {
    file: 'src/*',
    rule: 'Claude|Anthropic',
    line: /~\/\.claude\/skills|\.claude\/skills/,
    reason: 'Ruta real del sistema de archivos `~/.claude/skills` (no se puede renombrar).'
  }
]

function fileMatches(pattern: string, file: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === file
  const re = new RegExp(
    '^' +
      pattern
        .split('*')
        .map(escapeRe)
        .join('[^/]*')
        .replace(/\[\^\/\]\*$/, '.*') +
      '$'
  )
  return re.test(file)
}
function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__snapshots__') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.some((e) => name.endsWith(e)) && !/\.test\.[^.]+$/.test(name)) out.push(p)
  }
}

/** Devuelve las líneas con el código "vivo" (sin comentarios) para .ts/.tsx; .md se analiza entero. */
function liveLines(file: string, text: string): Array<{ n: number; text: string }> {
  const lines = text.split('\n')
  if (file.endsWith('.md')) return lines.map((t, i) => ({ n: i + 1, text: t }))
  const out: Array<{ n: number; text: string }> = []
  let inBlock = false
  lines.forEach((raw, i) => {
    let t = raw
    if (inBlock) {
      const end = t.indexOf('*/')
      if (end < 0) return
      inBlock = false
      t = t.slice(end + 2)
    }
    const trimmed = t.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      return
    }
    // Bloque `/* ... */` que arranca a mitad de línea y no cierra en ella
    const open = t.indexOf('/*')
    if (open >= 0 && t.indexOf('*/', open) < 0) {
      inBlock = true
      t = t.slice(0, open)
    }
    // Comentario al final de una línea de código (evita `https://`)
    t = t.replace(/(^|\s)\/\/.*$/, '$1')
    out.push({ n: i + 1, text: t })
  })
  return out
}

function stringLiterals(line: string): string[] {
  return line.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []
}

function scan(): string[] {
  const files: string[] = []
  for (const d of DIRS) walk(join(ROOT, d), files)
  const failures: string[] = []
  for (const abs of files.sort()) {
    const rel = relative(ROOT, abs)
    for (const { n, text } of liveLines(rel, readFileSync(abs, 'utf8'))) {
      for (const rule of RULES) {
        const hit = rule.inStrings ? stringLiterals(text).some((lit) => rule.re.test(lit)) : rule.re.test(text)
        if (!hit) continue
        const excused = EXCEPTIONS.some((e) => e.rule === rule.id && fileMatches(e.file, rel) && e.line.test(text))
        if (!excused) {
          failures.push(
            `${rel}:${n} [${rule.id}] ${text.trim().slice(0, 120)}\n  -> usa src/shared/labels.ts o renombrá el texto visible; si es un identificador interno, agregá una excepción justificada en visible-terms.test.ts`
          )
        }
      }
    }
  }
  return failures
}

describe('guardia de términos visibles', () => {
  it('ningún texto visible nombra productos de terceros', () => {
    expect(scan().join('\n')).toBe('')
  })
})
