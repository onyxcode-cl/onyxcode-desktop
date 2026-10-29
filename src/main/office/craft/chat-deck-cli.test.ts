import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatDeckCommands } from './chat-deck'
import { runChatDeckCli, MAX_SPEC_BYTES } from './chat-deck-cli'
import type { PptxSpec } from '@shared/chat-doc-spec'

const SPEC: PptxSpec = {
  palette: { bg: '#0E2A2F', text: '#F4F1EA', accent: '#F2B544' },
  fonts: { title: 'Georgia', body: 'Arial' },
  slides: [
    { title: 'Portada', bullets: ['Sub'] },
    {
      layout: 'free',
      title: 'Libre',
      elements: [
        { type: 'text', x: 60, y: 60, w: 400, h: 100, text: 'Hola', size: 40 },
        { type: 'shape', shape: 'ellipse', x: 500, y: 100, w: 200, h: 200, fill: '#F2B544' }
      ]
    }
  ]
}

describe('build_chat_deck (CLI de las Tareas con el motor del Chat)', () => {
  let dir: string
  let fakeBin: string
  let out: string
  let errs: string[]
  let logs: string[]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lazunox-cdcli-'))
    fakeBin = join(dir, 'deckcraft-cli')
    writeFileSync(fakeBin, '#!/bin/sh\n')
    chmodSync(fakeBin, 0o755)
    out = join(dir, 'salida.pptx')
    errs = []
    logs = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const spec = (v: unknown): string => {
    const p = join(dir, 'spec.json')
    writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v))
    return p
  }
  const deps = (run: (b: string, a: string[], t: number) => Promise<void>) => ({
    deckcraft: fakeBin,
    run,
    log: (m: string) => logs.push(m),
    err: (m: string) => errs.push(m)
  })
  /** runCraft falso: comprueba los argumentos y «genera» el archivo donde dice --save. */
  const okRun = (seen: { args?: string[]; binary?: string }) => async (binary: string, args: string[]) => {
    seen.binary = binary
    seen.args = args
    writeFileSync(args[args.indexOf('--save') + 1], 'PPTX-FALSO')
  }

  it('spec válido: usa los MISMOS comandos que el Chat, escribe la salida y no interpreta nada como comando', async () => {
    const seen: { args?: string[]; binary?: string } = {}
    const code = await runChatDeckCli([spec(SPEC), out], deps(okRun(seen)))
    expect(code).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe('PPTX-FALSO')
    expect(seen.binary).toBe(fakeBin)
    const cmds = chatDeckCommands(SPEC)
    expect(seen.args![0]).toBe('run')
    expect(seen.args!.filter((_, i, a) => a[i - 1] === '--cmd')).toEqual(cmds)
    expect(logs.join('\n')).toContain('2 diapositivas')
  })

  it('spec inválido: error sin ejecutar nada ni crear la salida', async () => {
    let called = false
    const run = async (): Promise<void> => {
      called = true
    }
    for (const bad of [
      { slides: [] },
      { theme: 'neon', slides: [{ title: 'x' }] },
      { slides: [{ title: 'x', layout: 'free', elements: [{ type: 'shape', shape: 'rm -rf', x: 0, y: 0, w: 1, h: 1 }] }] },
      '{no es json',
      '[]'
    ]) {
      errs.length = 0
      expect(await runChatDeckCli([spec(bad), out], deps(run))).toBe(1)
      expect(errs[0]).toContain('ERROR')
    }
    expect(called).toBe(false)
    expect(existsSync(out)).toBe(false)
  })

  it('sin DeckCraft sale con código 3 (aviso claro) y no ejecuta nada', async () => {
    let called = false
    const run = async (): Promise<void> => {
      called = true
    }
    for (const deckcraft of [undefined, '', join(dir, 'no-existe'), 'deckcraft-cli']) {
      errs.length = 0
      const code = await runChatDeckCli([spec(SPEC), out], { deckcraft, run, err: (m) => errs.push(m) })
      expect(code).toBe(3)
      expect(errs[0]).toContain('DeckCraft no está instalado')
    }
    expect(called).toBe(false)
  })

  it('nunca sobrescribe: ni un archivo existente ni un enlace simbólico', async () => {
    writeFileSync(out, 'DEL USUARIO')
    let called = false
    const run = async (): Promise<void> => {
      called = true
    }
    expect(await runChatDeckCli([spec(SPEC), out], deps(run))).toBe(1)
    expect(readFileSync(out, 'utf8')).toBe('DEL USUARIO')
    const link = join(dir, 'enlace.pptx')
    symlinkSync(join(dir, 'otro.pptx'), link)
    expect(await runChatDeckCli([spec(SPEC), link], deps(run))).toBe(1)
    expect(existsSync(join(dir, 'otro.pptx'))).toBe(false)
    expect(called).toBe(false)
    expect(errs.join('\n')).toContain('no se sobrescribe')
  })

  it('uso: exige dos argumentos y salida .pptx; un JSON enorme se rechaza', async () => {
    expect(await runChatDeckCli([], deps(okRun({})))).toBe(2)
    expect(await runChatDeckCli([spec(SPEC), join(dir, 'x.txt')], deps(okRun({})))).toBe(2)
    expect(await runChatDeckCli([spec('x'.repeat(MAX_SPEC_BYTES + 1)), out], deps(okRun({})))).toBe(1)
  })

  it('si DeckCraft falla: código 1 con su mensaje y sin dejar la salida', async () => {
    const run = async (): Promise<void> => {
      throw new Error('boom en deckcraft')
    }
    expect(await runChatDeckCli([spec(SPEC), out], deps(run))).toBe(1)
    expect(errs[0]).toContain('DeckCraft falló: boom en deckcraft')
    expect(existsSync(out)).toBe(false)
  })

  it('contenido hostil (rutas y comandos como texto) viaja como DATO dentro de un --cmd, nunca como argumento propio', async () => {
    const hostile: PptxSpec = { slides: [{ title: '$(touch /tmp/x); --save /etc/passwd', bullets: ['--cmd rm -rf ~', '../../../x'] }] }
    const seen: { args?: string[] } = {}
    expect(await runChatDeckCli([spec(hostile), out], deps(okRun(seen)))).toBe(0)
    const args = seen.args!
    // Los únicos argumentos que no son `--cmd <json>` son `run`, `--save` y la ruta de salida temporal.
    expect(args.filter((a, i) => a === '--save' || args[i - 1] === '--save')).toHaveLength(2)
    expect(args.filter((a) => a === '--save')).toHaveLength(1)
    expect(args.filter((a, i) => i > 0 && args[i - 1] !== '--cmd' && a !== '--cmd' && a !== '--save' && args[i - 1] !== '--save')).toEqual(
      []
    )
  })
})
