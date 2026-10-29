import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { buildInlineConfig } from './config'
import { MAX_DOCX_BLOCKS, MAX_CELL_CHARS, MAX_COLS_PER_ROW, MAX_ROWS_PER_SHEET, MAX_SHEETS } from '../../shared/chat-doc-spec'

/**
 * Word, Excel y PDF de las Tareas con el MISMO motor y la MISMA guía de diseño que el Chat (como `skill-pptx-chat-parity.test.ts` con pptx).
 * La fuente de la guía es `chat.md`; el prompt inline de `config.ts` y las skills deben decir lo mismo, palabra por palabra.
 */
const ROOT = resolve(__dirname, '../../..')
const norm = (t: string): string => t.replace(/`/g, '').replace(/\s+/g, ' ').trim()
const read = (f: string): string => readFileSync(resolve(ROOT, f), 'utf8')
const chatRaw = read('resources/opencode/agents/chat.md')
const chatMd = norm(chatRaw)
const inline = norm(JSON.stringify(buildInlineConfig()).replace(/\\"/g, '"'))
const skills = {
  docx: read('resources/opencode/skills/docx/SKILL.md'),
  xlsx: read('resources/opencode/skills/xlsx/SKILL.md'),
  pdf: read('resources/opencode/skills/pdf/SKILL.md')
}

/** La guía de diseño de un formato en chat.md: la línea que empieza con `lead`. */
function chatGuide(lead: string): string {
  const line = chatRaw.split('\n').find((l) => l.trimStart().startsWith(`- ${lead}`))
  expect(line, `falta la guía «${lead}» en chat.md`).toBeTruthy()
  return norm(line!.trim().slice(2))
}

const GUIDES = [
  {
    kind: 'docx',
    lead: 'Diseño del Word:',
    claves: ['encabezados reales', 'total_row', 'widths_cm', 'como TEXTO dentro de la celda', 'no una plantilla fija', 'toc:true']
  },
  {
    kind: 'xlsx',
    lead: 'Diseño del Excel:',
    claves: [
      'columnFormats se pone SIEMPRE',
      'fórmulas reales',
      'nunca el total pegado como número',
      'misma unidad y escala',
      'no con una plantilla fija'
    ]
  },
  {
    kind: 'pdf',
    lead: 'Diseño del PDF:',
    claves: ['@page { size: A4', 'page-break-inside: avoid', 'buen contraste', 'en vez de repetir una plantilla', 'elemento visual real']
  }
] as const

describe('Word, Excel y PDF: la guía de diseño del Chat es la de las skills (una sola fuente)', () => {
  for (const g of GUIDES) {
    it(`${g.kind}: chat.md, el prompt inline de config.ts y la skill dicen lo mismo, palabra por palabra`, () => {
      const guide = chatGuide(g.lead)
      expect(guide.length).toBeGreaterThan(900)
      expect(inline.includes(guide), `config.ts (prompt inline) se desvió de chat.md en «${g.lead}»: copia de nuevo el bloque`).toBe(true)
      expect(norm(skills[g.kind]).includes(guide), `la skill ${g.kind} se desvió de chat.md en «${g.lead}»: copia de nuevo el bloque`).toBe(
        true
      )
      for (const k of g.claves) expect(guide, k).toContain(k)
    })
  }

  it('los puntos clave del esquema están en chat.md, en el prompt inline y en la skill (formatos de columna, fórmulas, gráficos, bloques)', () => {
    const claves: Record<'docx' | 'xlsx', string[]> = {
      xlsx: [
        'columnFormats',
        '"currency"',
        '"integer"',
        '"decimal"',
        '"percent"',
        '{"formula":"SUM(B2:B5)","value":1100000}',
        'entre 120 y 1200',
        'column, bar, line, pie o area'
      ],
      docx: [
        'total_row',
        'widths_cm',
        'zebra',
        'page_break',
        'page_numbers',
        'cada bloque numbered reinicia en 1',
        'chileno 1.234.567,50',
        '"hoy"'
      ]
    }
    for (const kind of ['xlsx', 'docx'] as const)
      for (const k of claves[kind]) {
        expect(chatMd, `chat.md: ${k}`).toContain(k)
        expect(inline, `config.ts: ${k}`).toContain(k)
        expect(norm(skills[kind]), `skill ${kind}: ${k}`).toContain(k)
      }
  })

  it('los límites que dice la skill son los del validador del Chat (no se desincronizan con chat-doc-spec.ts)', () => {
    const miles = (n: number): string => n.toLocaleString('es-CL')
    expect(MAX_DOCX_BLOCKS).toBe(300)
    expect(skills.docx).toContain(`hasta ${MAX_DOCX_BLOCKS}`)
    const x = skills.xlsx
    for (const k of [
      `Hasta ${MAX_SHEETS} hojas`,
      `${miles(MAX_ROWS_PER_SHEET)} filas`,
      `${MAX_COLS_PER_ROW} columnas`,
      `${miles(MAX_CELL_CHARS)} caracteres`
    ])
      expect(x, k).toContain(k)
  })
})

describe('las tres skills: camino principal con el motor del Chat, respaldo y traducción que conserva el diseño', () => {
  it('cada skill pone primero el script del Chat, conserva el respaldo y explica el código 3', () => {
    const casos: [keyof typeof skills, string, string][] = [
      ['docx', 'build_chat_docx.py', 'build_docx.py'],
      ['xlsx', 'build_chat_xlsx.py', 'build_xlsx.py'],
      ['pdf', 'build_chat_pdf.py', 'build_pdf.py']
    ]
    for (const [k, principal, respaldo] of casos) {
      const s = skills[k]
      expect(s, k).toContain('camino principal')
      expect(s, k).toContain(principal)
      expect(s, k).toContain(respaldo)
      expect(s.indexOf(principal), `${k}: el script del Chat va antes que el respaldo`).toBeLessThan(
        s.indexOf(respaldo, s.indexOf('## ') + 1)
      )
      expect(s, k).toMatch(/\*\*3 = /)
      expect(s, k).toContain('MISMO')
      // No se inventan preguntas nuevas: solo la skill pptx pregunta el formato.
      expect(s, k).not.toContain('herramienta `question`')
    }
  })

  it('«traduce este Word/Excel/PDF» tiene un camino explícito: script propio, copia con sufijo, texto en JSON de pares y comparación de estructura', () => {
    for (const [k, script] of [
      ['docx', 'translate_docx.py'],
      ['xlsx', 'translate_xlsx.py'],
      ['pdf', 'translate_pdf.py']
    ] as const) {
      const s = skills[k]
      const i = s.search(/Traducir un (Word|Excel|PDF)/)
      expect(i, k).toBeGreaterThan(0)
      const sec = s.slice(i, i + 4500)
      expect(sec, k).toContain(script)
      expect(sec, k).toContain('extraer')
      expect(sec, k).toContain('aplicar')
      expect(sec, k).toMatch(/NUEVO|nunca el original|El original nunca se toca/)
      expect(sec, k).toContain('sufijo del idioma')
      expect(sec, k).toContain('ESTRUCTURA')
      expect(sec, k).toContain('JSON de pares')
    }
    // Excel: solo textos; fórmulas y formatos intactos; no usa openpyxl para guardar (perdería gráficos).
    expect(skills.xlsx).toContain('SOLO los textos')
    expect(skills.xlsx).toContain('perdería gráficos')
  })

  it('el CSP de build_chat_pdf.py es exactamente el ARTIFACT_CSP del Chat', () => {
    const ts = read('src/main/extras/artifact-window.ts')
    const arr = /export const ARTIFACT_CSP = \[([\s\S]*?)\]\.join\('; '\)/.exec(ts)![1]
    const chat = [...arr.matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]).join('; ')
    const py = read('resources/opencode/skills/pdf/scripts/build_chat_pdf.py')
    const decl = /CSP = \(([\s\S]*?)\)\n/.exec(py)![1]
    const pyCsp = [...decl.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('')
    expect(pyCsp).toBe(chat)
    expect(pyCsp).toContain("connect-src 'none'")
  })
})

const hasPython = spawnSync('python3', ['--version']).status === 0
const hasNode = spawnSync('node', ['--version']).status === 0

describe.skipIf(!hasPython || !hasNode || process.platform === 'win32')(
  'build_chat_docx.py / build_chat_xlsx.py + .cjs empaquetado, de extremo a extremo con motores falsos',
  () => {
    it('empaquetados con esbuild como scripts/build-chat-office.mjs: generan, validan, no sobrescriben y caen con código 3', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'lazunox-skill-office-'))
      try {
        const shared = join(dir, 'skill/_shared')
        mkdirSync(shared, { recursive: true })
        for (const f of ['render.py', 'chat_engine.py'])
          writeFileSync(join(shared, f), readFileSync(resolve(ROOT, 'resources/opencode/skills/_shared', f)))
        const mjs = read('scripts/build-chat-office.mjs')
        const fakes: Record<'docx' | 'xlsx', string> = {
          docx: '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "--save" ] && O="$2"; shift; done\nprintf FALSO-WORD > "$O"\n',
          xlsx: '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "--out" ] && O="$2"; shift; done\nprintf FALSO-EXCEL > "$O"\n'
        }
        const specs = {
          docx: { title: 'T', blocks: [{ type: 'paragraph', text: 'Hola' }] },
          xlsx: {
            sheets: [
              {
                name: 'H',
                rows: [
                  ['a', 'b'],
                  [1, 2]
                ]
              }
            ]
          }
        }
        const envVar = { docx: 'LAZUNOX_WORDCRAFT', xlsx: 'LAZUNOX_GRIDCRAFT' }
        for (const kind of ['docx', 'xlsx'] as const) {
          // El script de empaquetado apunta a estas entradas y salidas (no se copia su lógica: se comprueba que existan).
          expect(mjs).toContain(`chat-${kind}-cli.ts`)
          const scripts = join(dir, `skill/${kind}/scripts`)
          mkdirSync(scripts, { recursive: true })
          await build({
            entryPoints: [resolve(ROOT, `src/main/office/craft/chat-${kind}-cli.ts`)],
            outfile: join(scripts, `build_chat_${kind}.cjs`),
            bundle: true,
            platform: 'node',
            target: 'node22',
            format: 'cjs',
            alias: { '@shared': resolve(ROOT, 'src/shared') },
            logLevel: 'silent'
          })
          expect(readFileSync(join(scripts, `build_chat_${kind}.cjs`), 'utf8')).not.toMatch(/require\(["']electron["']\)/)
          writeFileSync(
            join(scripts, `build_chat_${kind}.py`),
            readFileSync(resolve(ROOT, `resources/opencode/skills/${kind}/scripts/build_chat_${kind}.py`))
          )
          const fake = join(dir, `${kind}craft-cli`)
          writeFileSync(fake, fakes[kind])
          chmodSync(fake, 0o755)
          const spec = join(dir, `${kind}.json`)
          writeFileSync(spec, JSON.stringify(specs[kind]))
          const env = { PATH: '/usr/bin:/bin', LAZUNOX_NODE: process.execPath, [envVar[kind]]: fake }
          const run = (o: string, e: Record<string, string> = env): ReturnType<typeof spawnSync> =>
            spawnSync('python3', ['-I', join(scripts, `build_chat_${kind}.py`), spec, o], {
              env: { ...e, LAZUNOX_BIN_DIR: join(dir, 'vacio') },
              encoding: 'utf8'
            })
          const o1 = join(dir, `ok.${kind}`)
          const r1 = run(o1)
          expect(r1.stderr, kind).toBe('')
          expect(r1.status, kind).toBe(0)
          expect(r1.stdout).toContain('motor del Chat')
          expect(readFileSync(o1, 'utf8')).toBe(kind === 'docx' ? 'FALSO-WORD' : 'FALSO-EXCEL')
          // No sobrescribe.
          const r2 = run(o1)
          expect(r2.status).toBe(1)
          expect(String(r2.stderr)).toContain('no se sobrescribe')
          // Esquema inválido: error y nada creado.
          writeFileSync(spec, JSON.stringify({}))
          const o3 = join(dir, `malo.${kind}`)
          expect(run(o3).status).toBe(1)
          expect(existsSync(o3)).toBe(false)
          // Sin el programa de ArtCraft: código 3 y mensaje claro.
          const r4 = run(join(dir, `tres.${kind}`), { PATH: '/usr/bin:/bin', LAZUNOX_NODE: process.execPath })
          expect(r4.status).toBe(3)
          expect(String(r4.stderr)).toContain(kind === 'docx' ? 'build_docx.py' : 'build_xlsx.py')
          // Sin Node ni .cjs: código 3 también.
          rmSync(join(scripts, `build_chat_${kind}.cjs`))
          expect(run(join(dir, `cuatro.${kind}`)).status).toBe(3)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }, 30_000)
  }
)

/** Las pruebas de Python de estas skills (con el intérprete incluido de la app, que trae python-docx, openpyxl y PyMuPDF). */
const bundledPy = resolve(ROOT, 'resources/python-bin/mac-arm64/python/bin/python3')
describe.skipIf(!(process.platform === 'darwin' && process.arch === 'arm64' && existsSync(bundledPy)))(
  'pruebas de Python de las skills de oficina (traducción, comparación y PDF del Chat)',
  () => {
    const casos: [string, string][] = [
      ['xlsx', 'tests/test_translate.py'],
      ['docx', 'tests/test_translate.py'],
      ['pdf', 'tests/test_translate.py'],
      ['pdf', 'tests/test_chat_pdf.py'],
      ['_shared', 'tests/test_comparar.py']
    ]
    for (const [skill, file] of casos) {
      it(`${skill}/${file}`, () => {
        const r = spawnSync(bundledPy, ['-m', 'unittest', file], {
          cwd: resolve(ROOT, 'resources/opencode/skills', skill),
          env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
          encoding: 'utf8',
          timeout: 120_000
        })
        expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-1500)).toBe(0)
      }, 130_000)
    }
  }
)
