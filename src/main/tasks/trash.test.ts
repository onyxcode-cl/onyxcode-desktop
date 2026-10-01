import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveE2eTrashDir, trashToDir } from './trash'

describe('ONYXCODE_E2E_TRASH_DIR (solo pruebas)', () => {
  it('se honra sin empaquetar y solo con ruta absoluta', () => {
    expect(resolveE2eTrashDir({ isPackaged: false, env: { ONYXCODE_E2E_TRASH_DIR: '/tmp/x' } })).toBe('/tmp/x')
    expect(resolveE2eTrashDir({ isPackaged: false, env: { ONYXCODE_E2E_TRASH_DIR: 'relativa' } })).toBeNull()
    expect(resolveE2eTrashDir({ isPackaged: false, env: {} })).toBeNull()
  })
  it('empaquetada: se ignora siempre', () => {
    expect(resolveE2eTrashDir({ isPackaged: true, env: { ONYXCODE_E2E_TRASH_DIR: '/tmp/x' } })).toBeNull()
  })
  it('mueve el archivo a la carpeta de pruebas sin pisar nombres', async () => {
    const base = mkdtempSync(join(tmpdir(), 'trash-'))
    try {
      const trash = trashToDir(join(base, 'papelera'), () => 1)
      writeFileSync(join(base, 'a.txt'), 'uno')
      await trash(join(base, 'a.txt'))
      writeFileSync(join(base, 'a.txt'), 'dos')
      await trash(join(base, 'a.txt'))
      expect(existsSync(join(base, 'a.txt'))).toBe(false)
      expect(readdirSync(join(base, 'papelera')).sort()).toEqual(['1-0-a.txt', '1-1-a.txt'])
      expect(readFileSync(join(base, 'papelera', '1-0-a.txt'), 'utf8')).toBe('uno')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
  it('guardia estática: solo trash.ts la lee y lo hace bajo !isPackaged', () => {
    const root = resolve(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') && readFileSync(f, 'utf8').includes('ONYXCODE_E2E_TRASH_DIR'))
          hits.push(f)
      }
    }
    walk(root)
    expect(hits.map((h) => h.slice(root.length))).toEqual(['/main/tasks/trash.ts'])
    expect(readFileSync(hits[0], 'utf8')).toMatch(/const dir = !i\.isPackaged \? i\.env\.ONYXCODE_E2E_TRASH_DIR : undefined/)
  })
})
