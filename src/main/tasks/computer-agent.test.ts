// Selección del agente `computer` por plataforma (C6): macOS no cambia; Windows solo con la función encendida.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyComputerAgent, computerAgentSourceFile } from './computer-agent'

let root: string
let bundled: string
let winBundled: string
let dest: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lz-agent-'))
  bundled = join(root, 'bundle')
  dest = join(root, 'dest')
  winBundled = join(root, 'bundle-win')
  mkdirSync(bundled)
  mkdirSync(winBundled)
  mkdirSync(dest)
  writeFileSync(join(bundled, 'computer.md'), 'MAC')
  writeFileSync(join(winBundled, 'computer.win.md'), 'WIN')
  // Lo que deja prepareOpencodeConfigDir: copia todos los .md.
  writeFileSync(join(dest, 'computer.md'), 'MAC')
  writeFileSync(join(dest, 'computer.win.md'), 'WIN')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const run = (platform: NodeJS.Platform, enabled: boolean | undefined, winDirs = [winBundled]): string | null =>
  applyComputerAgent({ platform, enabled, agentsDest: dest, bundledAgentsDirs: [bundled], bundledWinAgentsDirs: winDirs })

describe('computerAgentSourceFile', () => {
  it('solo win32 con la función encendida elige computer.win.md', () => {
    expect(computerAgentSourceFile('win32', true)).toBe('computer.win.md')
    expect(computerAgentSourceFile('win32', false)).toBe('computer.md')
    expect(computerAgentSourceFile('win32', undefined)).toBe('computer.md')
    expect(computerAgentSourceFile('darwin', true)).toBe('computer.md')
    expect(computerAgentSourceFile('linux', true)).toBe('computer.md')
  })
})

describe('applyComputerAgent', () => {
  it('macOS: no hace nada (ni siquiera con la bandera)', () => {
    expect(run('darwin', true)).toBeNull()
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('MAC')
    expect(existsSync(join(dest, 'computer.win.md'))).toBe(true)
  })

  it('Windows con la función encendida: computer.md pasa a ser el de Windows y no queda computer.win suelto', () => {
    expect(run('win32', true)).toBe('computer.win.md')
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('WIN')
    expect(existsSync(join(dest, 'computer.win.md'))).toBe(false)
  })

  it('Windows con la función apagada o sin decidir: se restaura el de macOS', () => {
    run('win32', true)
    expect(run('win32', false)).toBe('computer.md')
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('MAC')
    writeFileSync(join(dest, 'computer.md'), 'WIN')
    expect(run('win32', undefined)).toBe('computer.md')
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('MAC')
  })

  it('es idempotente', () => {
    run('win32', true)
    expect(run('win32', true)).toBe('computer.win.md')
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('WIN')
  })

  it('usa la segunda carpeta del bundle si la primera no trae el archivo (extraResources del paquete)', () => {
    const extra = join(root, 'extra')
    mkdirSync(extra)
    writeFileSync(join(extra, 'computer.win.md'), 'WIN2')
    rmSync(join(winBundled, 'computer.win.md'))
    expect(run('win32', true, [winBundled, extra])).toBe('computer.win.md')
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('WIN2')
  })

  it('falla cerrado: encendida y sin computer.win.md en el bundle, NO deja el agente de macOS', () => {
    rmSync(join(winBundled, 'computer.win.md'))
    expect(run('win32', true)).toBeNull()
    expect(existsSync(join(dest, 'computer.md'))).toBe(false)
  })

  it('apagada y sin computer.win.md: no toca nada', () => {
    rmSync(join(winBundled, 'computer.win.md'))
    expect(run('win32', false)).toBe('computer.md')
    expect(readFileSync(join(dest, 'computer.md'), 'utf8')).toBe('MAC')
  })
})
