import { describe, expect, it } from 'vitest'
import type { TasksSandboxState, TasksSandboxStatus } from '@shared/ipc-tasks'
import { sandboxView } from './sandbox-view'

const st = (state: TasksSandboxState, o: Partial<TasksSandboxStatus> = {}): TasksSandboxStatus => ({
  backend: 'wsl',
  state,
  setup: null,
  ...o
})

describe('sandboxView', () => {
  it('fuera de Windows nunca pinta ni bloquea (macOS: el aislamiento es del sistema)', () => {
    for (const b of ['seatbelt', 'none'] as const) {
      expect(sandboxView(null, b)).toMatchObject({ kind: 'hidden', blocksStart: false, actions: [] })
      expect(sandboxView(st('needsSetup'), b)).toMatchObject({ kind: 'hidden', blocksStart: false })
    }
  })
  it('sin respuesta todavía: «comprobando», bloquea y sin botones', () => {
    expect(sandboxView(null, 'wsl')).toMatchObject({ kind: 'checking', blocksStart: true, actions: [] })
  })
  it('listo: no pinta nada y no bloquea', () => {
    expect(sandboxView(st('ready'), 'wsl')).toMatchObject({ kind: 'hidden', blocksStart: false })
  })
  it('por instalar: un solo botón (instalar); con actualización, «actualizar»', () => {
    expect(sandboxView(st('needsSetup'), 'wsl')).toMatchObject({
      kind: 'needsSetup',
      actions: ['setup'],
      setupLabel: 'tasks.sandbox.needsSetup.action'
    })
    expect(sandboxView(st('needsSetup', { detail: 'update:rootfs' }), 'wsl')).toMatchObject({
      kind: 'needsUpdate',
      actions: ['setup'],
      setupLabel: 'tasks.sandbox.needsUpdate.action'
    })
  })
  it('instalando: progreso acotado, fase traducible y solo «cancelar»', () => {
    const v = sandboxView(st('needsSetup', { setup: { running: true, pct: 142, phase: 'downloading' } }), 'wsl')
    expect(v).toMatchObject({
      kind: 'installing',
      pct: 100,
      phase: 'tasks.sandbox.phase.downloading',
      actions: ['cancel'],
      blocksStart: true
    })
    expect(sandboxView(st('needsSetup', { setup: { running: true, pct: -5, phase: 'inventada' } }), 'wsl')).toMatchObject({
      pct: 0,
      phase: 'tasks.sandbox.phase.installing'
    })
  })
  it('fallo de la instalación: motivo traducido (nunca el texto crudo) y reintentar', () => {
    const base = { setup: { running: false, pct: 0, phase: '', error: 'offline' } }
    expect(sandboxView(st('needsSetup', base), 'wsl')).toMatchObject({
      kind: 'setupError',
      error: 'tasks.sandbox.error.offline',
      actions: ['setup', 'recheck'],
      setupLabel: 'tasks.sandbox.retry'
    })
    expect(sandboxView(st('needsSetup', { setup: { ...base.setup, error: 'C:\\secreto' } }), 'wsl')).toMatchObject({
      error: 'tasks.sandbox.error.generic'
    })
  })
  it('un error viejo no tapa un estado que ya no se arregla instalando (p. ej. falta WSL): se ve el estado real', () => {
    expect(sandboxView(st('needsWsl', { setup: { running: false, pct: 0, phase: '', error: 'offline' } }), 'wsl')).toMatchObject({
      kind: 'needsWsl'
    })
  })
  it('guías de WSL: solo «volver a comprobar» (no se ejecuta nada como administrador)', () => {
    for (const [state, kind] of [
      ['needsWsl', 'needsWsl'],
      ['needsWsl2', 'needsWsl2'],
      ['needsVirtualization', 'needsVirtualization']
    ] as const) {
      expect(sandboxView(st(state), 'wsl')).toMatchObject({ kind, actions: ['recheck'], blocksStart: true })
    }
    expect(sandboxView(st('needsWsl', { detail: 'org' }), 'wsl').body).toBe('tasks.sandbox.needsWsl.org')
  })
  it('política de la organización y puertas cerradas: bloquean y NO ofrecen ningún botón', () => {
    expect(sandboxView(st('policyDisabled'), 'wsl')).toMatchObject({ kind: 'policy', actions: [], blocksStart: true })
    for (const detail of ['flag', 'build', 'provider', 'report', 'backend']) {
      expect(sandboxView(st('unsupported', { detail }), 'wsl')).toMatchObject({ kind: 'unavailable', actions: [], blocksStart: true })
    }
  })
  it('roto: reparar solo si es la carga; el resto solo se vuelve a comprobar, con su explicación', () => {
    expect(sandboxView(st('broken', { detail: 'payload' }), 'wsl')).toMatchObject({
      kind: 'broken',
      actions: ['setup', 'recheck'],
      setupLabel: 'tasks.sandbox.broken.repair'
    })
    for (const [detail, body] of [
      ['landlock:1', 'tasks.sandbox.broken.landlock'],
      ['interop', 'tasks.sandbox.broken.interop'],
      ['drives', 'tasks.sandbox.broken.drives'],
      ['foreign', 'tasks.sandbox.broken.foreign'],
      ['wsl1', 'tasks.sandbox.broken.wsl1']
    ] as const) {
      expect(sandboxView(st('broken', { detail }), 'wsl')).toMatchObject({ kind: 'broken', body, actions: ['recheck'], blocksStart: true })
    }
    const generic = sandboxView(st('broken', { detail: 'status' }), 'wsl')
    expect(generic).toMatchObject({ body: 'tasks.sandbox.broken.generic', detail: 'status', actions: ['recheck'] })
  })
  it('un estado desconocido cierra (unavailable) en vez de dejar pasar', () => {
    expect(sandboxView(st('weird' as TasksSandboxState), 'wsl')).toMatchObject({ kind: 'unavailable', blocksStart: true, actions: [] })
  })
  it('todo lo que pinta bloquea el inicio de tareas', () => {
    const states: TasksSandboxState[] = [
      'needsSetup',
      'needsWsl',
      'needsWsl2',
      'needsVirtualization',
      'policyDisabled',
      'unsupported',
      'broken'
    ]
    for (const s of states) expect(sandboxView(st(s), 'wsl').blocksStart, s).toBe(true)
  })
})
