import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { buildInlineConfig } from './config'

const ROOT = resolve(__dirname, '../../..')
const norm = (t: string): string => t.replace(/\s+/g, ' ').trim()
const chatMd = norm(readFileSync(resolve(ROOT, 'resources/opencode/agents/chat.md'), 'utf8'))
const skillMd = readFileSync(resolve(ROOT, 'resources/opencode/skills/pptx/SKILL.md'), 'utf8')
const skill = norm(skillMd)

/** La guía de diseño de presentaciones del Chat: de `theme` hasta el gráfico (antes de la regla de preguntar el formato). */
function chatDesignGuide(): string {
  const raw = readFileSync(resolve(ROOT, 'resources/opencode/agents/chat.md'), 'utf8')
  const a = raw.indexOf('  - `theme` (opcional')
  const b = raw.indexOf('- REGLA OBLIGATORIA')
  expect(a).toBeGreaterThan(0)
  expect(b).toBeGreaterThan(a)
  return norm(raw.slice(a, b))
}

describe('skill pptx ⇄ Chat: misma guía de diseño', () => {
  it('SKILL.md contiene la guía de diseño de chat.md palabra por palabra (theme, style, palette, fonts, background, free, variación, gráficos)', () => {
    const guide = chatDesignGuide()
    expect(guide.length).toBeGreaterThan(5000)
    // Mensaje útil si alguien cambia chat.md y no la skill: resincronizar el bloque de la skill desde chat.md.
    expect(
      skill.includes(guide),
      'La guía de diseño de SKILL.md se desvió de resources/opencode/agents/chat.md: copia de nuevo el bloque'
    ).toBe(true)
  })

  it('los puntos clave están también en el prompt inline del Chat (config.ts), en su forma condensada', () => {
    const inline = JSON.stringify(buildInlineConfig()).replace(/\\"/g, '"')
    for (const k of ['layout:"free"', '960 de ancho × 540 de alto', 'como mucho 40', 'Tahoma', 'palette', 'fillTo']) {
      expect(inline).toContain(k)
      expect(skill).toContain(k)
      expect(chatMd).toContain(k)
    }
  })

  it('conserva la pregunta obligatoria de formato, la ruta HTML y «inventa uno distinto cada vez»', () => {
    for (const k of [
      'Antes de empezar: pregunta el formato (obligatorio)',
      'Editable (.pptx)',
      'Diseño libre (HTML)',
      'herramienta `question`',
      'Ruta HTML',
      'inventa uno distinto cada vez'
    ]) {
      expect(skillMd).toContain(k)
    }
  })

  it('el camino principal es build_chat_deck.py y sigue habiendo respaldo (build_pptx, edit, inspect, check, código 3)', () => {
    expect(skillMd).toContain('python3 scripts/build_chat_deck.py spec.json salida.pptx')
    expect(skillMd).toContain('camino principal')
    for (const k of ['build_pptx.py', 'edit_pptx.py', 'inspect_pptx.py', 'check_pptx.py', 'código de salida 3', 'Código de salida 3']) {
      expect(skillMd.toLowerCase()).toContain(k.toLowerCase())
    }
  })
})

describe('skill pptx: build_chat_deck.py + .cjs empaquetado, de extremo a extremo con un DeckCraft falso', () => {
  const py = resolve(ROOT, 'resources/opencode/skills/pptx/scripts/build_chat_deck.py')
  const hasPython = spawnSync('python3', ['--version']).status === 0
  const hasNode = spawnSync('node', ['--version']).status === 0

  it.skipIf(!hasPython)('sin DeckCraft: código 3 y mensaje claro (no toca nada)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazunox-skill-'))
    try {
      writeFileSync(join(dir, 'spec.json'), JSON.stringify({ slides: [{ title: 'x' }] }))
      const r = spawnSync('python3', ['-I', py, join(dir, 'spec.json'), join(dir, 'o.pptx')], {
        env: { PATH: '/usr/bin:/bin', LAZUNOX_BIN_DIR: join(dir, 'vacio') },
        encoding: 'utf8'
      })
      expect(r.status).toBe(3)
      expect(r.stderr).toContain('DeckCraft no está instalado')
      expect(existsSync(join(dir, 'o.pptx'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!hasPython || !hasNode)(
    'empaquetado con esbuild como lo hace scripts/build-chat-deck.mjs: genera, valida y no sobrescribe',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'lazunox-skill-'))
      try {
        // Copia mínima de la skill con el .cjs recién empaquetado (mismas opciones que scripts/build-chat-deck.mjs).
        const scripts = join(dir, 'skill/pptx/scripts')
        const shared = join(dir, 'skill/_shared')
        spawnSync('mkdir', ['-p', scripts, shared])
        await build({
          entryPoints: [resolve(ROOT, 'src/main/office/craft/chat-deck-cli.ts')],
          outfile: join(scripts, 'build_chat_deck.cjs'),
          bundle: true,
          platform: 'node',
          target: 'node22',
          format: 'cjs',
          alias: { '@shared': resolve(ROOT, 'src/shared') },
          logLevel: 'silent'
        })
        expect(readFileSync(join(scripts, 'build_chat_deck.cjs'), 'utf8')).not.toMatch(/require\(["']electron["']\)/)
        writeFileSync(join(scripts, 'build_chat_deck.py'), readFileSync(py))
        writeFileSync(join(shared, 'render.py'), readFileSync(resolve(ROOT, 'resources/opencode/skills/_shared/render.py')))
        const fake = join(dir, 'deckcraft-cli')
        // `deckcraft-cli run --save OUT --cmd …`: escribe OUT y deja constancia de lo recibido.
        writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$@" > "$3.args"\nprintf FALSO > "$3"\n')
        chmodSync(fake, 0o755)
        const spec = join(dir, 'spec.json')
        writeFileSync(
          spec,
          JSON.stringify({
            palette: { bg: '#101820', text: '#FFFFFF', accent: '#FEE715' },
            slides: [{ title: 'Hola' }, { title: 'Dos', bullets: ['a'] }]
          })
        )
        const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', LAZUNOX_DECKCRAFT: fake }
        const run = (o: string): ReturnType<typeof spawnSync> =>
          spawnSync('python3', ['-I', join(scripts, 'build_chat_deck.py'), spec, o], { env, encoding: 'utf8' })
        const o1 = join(dir, 'ok.pptx')
        const r1 = run(o1)
        expect(r1.stderr).toBe('')
        expect(r1.status).toBe(0)
        expect(r1.stdout).toContain('Presentación creada')
        expect(readFileSync(o1, 'utf8')).toBe('FALSO')
        // No sobrescribe.
        const r2 = run(o1)
        expect(r2.status).toBe(1)
        expect(String(r2.stderr)).toContain('no se sobrescribe')
        // JSON inválido: error y nada creado.
        writeFileSync(spec, JSON.stringify({ slides: [] }))
        const o3 = join(dir, 'malo.pptx')
        const r3 = run(o3)
        expect(r3.status).toBe(1)
        expect(existsSync(o3)).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )
})
