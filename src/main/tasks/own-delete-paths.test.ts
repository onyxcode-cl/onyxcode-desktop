import { describe, expect, it } from 'vitest'
import { mapOwnDeletePaths } from './own-delete-paths'

describe('mismo alcance en Mac y WSL', () => {
  it('Mac conserva rutas absolutas y resuelve los nombres relativos desde cwd', () => {
    expect(mapOwnDeletePaths('/task', 'darwin', '/task/tmp', ['a', '/task/b'])).toEqual({
      cwd: '/task/tmp',
      paths: ['/task/tmp/a', '/task/b']
    })
  })
  it.each(['C', 'D'])('WSL traduce solo su montaje en disco %s', (drive) => {
    expect(
      mapOwnDeletePaths(`${drive}:\\Tarea`, 'win32', `/win/${drive.toLowerCase()}/Tarea/tmp`, [
        'ops.json',
        `/win/${drive.toLowerCase()}/Tarea/v3.pptx`
      ])
    ).toEqual({ cwd: `${drive}:\\Tarea\\tmp`, paths: [`${drive}:\\Tarea\\tmp\\ops.json`, `${drive}:\\Tarea\\v3.pptx`] })
  })
  it.each(['/tmp', '/win/d/Tarea', '/win/c/Otra', '/win/c/Tarea-extra', '/win/c/Tarea/../Otra'])('WSL rechaza cwd externo: %s', (cwd) => {
    expect(mapOwnDeletePaths('C:\\Tarea', 'win32', cwd, ['/win/c/Tarea/nuevo'])).toBeNull()
  })
  it.each(['/tmp/a', '/win/d/Tarea/a', '/win/c/Tarea/a:stream', '/win/c/Tarea/../a'])(
    'WSL rechaza destinos fuera, ADS y traversal: %s',
    (p) => {
      expect(mapOwnDeletePaths('C:\\Tarea', 'win32', '/win/c/Tarea', [p])).toBeNull()
    }
  )
})
