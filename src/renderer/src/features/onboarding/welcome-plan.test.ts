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
    expect(welcomeOverall({ engine: 'ready', office: 'pending' })).toBe('working')
    expect(welcomeOverall({ engine: 'ready', office: 'downloading', sandbox: 'failed' })).toBe('working')
  })

  it('«failed» si nada trabaja y algo falló; «ready» si todo está listo', () => {
    expect(welcomeOverall({ engine: 'ready', office: 'failed' })).toBe('failed')
    expect(welcomeOverall({ engine: 'ready', office: 'ready', sandbox: 'ready' })).toBe('ready')
    expect(welcomeOverall({})).toBe('ready')
  })

  it('solo se instala lo que espera su turno, en orden y sin el motor', () => {
    expect(toInstall({ engine: 'pending', office: 'pending', sandbox: 'pending' })).toEqual(['office', 'sandbox'])
    expect(toInstall({ engine: 'ready', office: 'ready', sandbox: 'pending' })).toEqual(['sandbox'])
    expect(toInstall({ office: 'failed' })).toEqual([])
  })

  it('los permisos van al final, después de las descargas', () => {
    expect(toInstall({ engine: 'ready', perms: 'pending', office: 'pending', sandbox: 'pending' })).toEqual(['office', 'sandbox', 'perms'])
    expect(welcomeOverall({ engine: 'ready', perms: 'pending' })).toBe('working')
    expect(canRetry({ perms: 'failed' })).toBe(true)
  })

  it('el aviso de reiniciar solo sale si los permisos quedaron en «failed»', () => {
    expect(needsRestartHint({ perms: 'failed' })).toBe(true)
    expect(needsRestartHint({ perms: 'downloading' })).toBe(false)
    expect(needsRestartHint({ perms: 'ready' })).toBe(false)
    expect(needsRestartHint({ office: 'failed' })).toBe(false)
  })

  it('reintentar solo vale para lo descargable', () => {
    expect(canRetry({ engine: 'failed' })).toBe(false)
    expect(canRetry({ engine: 'failed', office: 'failed' })).toBe(true)
    expect(canRetry({ office: 'ready' })).toBe(false)
  })
})
