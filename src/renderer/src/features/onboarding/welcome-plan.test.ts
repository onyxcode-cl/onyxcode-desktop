import { describe, expect, it } from 'vitest'
import { canRetry, engineState, needsRestartHint, toInstall, welcomeOverall } from './welcome-plan'

describe('welcome-plan', () => {
  it('el estado del motor sale de si se encontró', () => {
    expect(engineState(null)).toBe('checking')
    expect(engineState(true)).toBe('ready')
    expect(engineState(false)).toBe('failed')
  })

  it('«working» mientras algo se revisa, espera o descarga', () => {
    expect(welcomeOverall({ engine: 'checking' })).toBe('working')
    expect(welcomeOverall({ engine: 'ready', craft: 'pending' })).toBe('working')
    expect(welcomeOverall({ engine: 'ready', craft: 'downloading', sandbox: 'failed' })).toBe('working')
  })

  it('«failed» si nada trabaja y algo falló; «ready» si todo está listo', () => {
    expect(welcomeOverall({ engine: 'ready', craft: 'failed' })).toBe('failed')
    expect(welcomeOverall({ engine: 'ready', craft: 'ready', sandbox: 'ready' })).toBe('ready')
    expect(welcomeOverall({})).toBe('ready')
  })

  it('solo se instala lo que espera su turno, en orden y sin el motor', () => {
    expect(toInstall({ engine: 'pending', craft: 'pending', sandbox: 'pending' })).toEqual(['craft', 'sandbox'])
    expect(toInstall({ engine: 'ready', craft: 'ready', sandbox: 'pending' })).toEqual(['sandbox'])
    expect(toInstall({ craft: 'failed' })).toEqual([])
  })

  it('los permisos van al final, después de las descargas', () => {
    expect(toInstall({ engine: 'ready', perms: 'pending', craft: 'pending', sandbox: 'pending' })).toEqual(['craft', 'sandbox', 'perms'])
    expect(welcomeOverall({ engine: 'ready', perms: 'pending' })).toBe('working')
    expect(canRetry({ perms: 'failed' })).toBe(true)
  })

  it('el aviso de reiniciar solo sale si los permisos quedaron en «failed»', () => {
    expect(needsRestartHint({ perms: 'failed' })).toBe(true)
    expect(needsRestartHint({ perms: 'downloading' })).toBe(false)
    expect(needsRestartHint({ perms: 'ready' })).toBe(false)
    expect(needsRestartHint({ craft: 'failed' })).toBe(false)
  })

  it('reintentar solo vale para lo descargable', () => {
    expect(canRetry({ engine: 'failed' })).toBe(false)
    expect(canRetry({ engine: 'failed', craft: 'failed' })).toBe(true)
    expect(canRetry({ craft: 'ready' })).toBe(false)
  })
})
