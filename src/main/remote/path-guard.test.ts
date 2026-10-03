import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInsideReal, isSensitiveEither, isSensitivePath, realDirs, realpathLoose } from './path-guard'

describe('isSensitivePath', () => {
  it.each([
    '/p/.env',
    '/p/.env.local',
    '/p/.env.production',
    '/p/app/.ENV',
    '/p/server.pem',
    '/p/certs/private.key',
    '/p/store.p12',
    '/p/store.pfx',
    '/p/a.keystore',
    '/p/vault.kdbx',
    '/p/id_rsa',
    '/p/id_ed25519',
    '/p/.ssh/config',
    '/home/u/.ssh/known_hosts',
    '/home/u/.aws/credentials',
    '/home/u/.gnupg/pubring.kbx',
    '/home/u/.kube/config',
    '/home/u/.docker/config.json',
    '/p/.git/config',
    '/p/.git/hooks/pre-commit',
    '/p/.git/credentials',
    '/p/.npmrc',
    '/p/.netrc',
    '/p/.git-credentials',
    '/p/credentials.json',
    '/p/service-account-prod.json',
    '/home/u/.config/gcloud/credentials.db',
    '/home/u/.local/share/opencode/auth.json',
    '/home/u/Library/Keychains/login.keychain-db',
    '/p/terraform.tfstate'
  ])('%s es sensible', (p) => expect(isSensitivePath(p)).toBe(true))

  it.each([
    '/p/src/a.ts',
    '/p/README.md',
    '/p/.env.example',
    '/p/.env.sample',
    '/p/id_rsa.pub',
    '/p/.gitignore',
    '/p/.git/HEAD',
    '/p/environment.ts',
    '/p/keys.md'
  ])('%s no lo es', (p) => expect(isSensitivePath(p)).toBe(false))

  it('rutas con NUL se tratan como sensibles', () => expect(isSensitivePath('/p/a\0b')).toBe(true))
})

describe('realpathLoose / enlaces', () => {
  it('resuelve enlaces, tolera rutas que no existen y rechaza enlaces rotos fuera del camino', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-pg-')))
    try {
      mkdirSync(join(root, 'in'))
      mkdirSync(join(root, 'out'))
      writeFileSync(join(root, 'out', 'f.txt'), 'x')
      writeFileSync(join(root, 'in', '.env'), 'x')
      symlinkSync(join(root, 'out'), join(root, 'in', 'link'))
      symlinkSync(join(root, 'in', '.env'), join(root, 'in', 'notas.txt'))
      expect(realpathLoose(join(root, 'in', 'link', 'f.txt'))).toBe(join(root, 'out', 'f.txt'))
      expect(realpathLoose(join(root, 'in', 'nuevo', 'a.ts'))).toBe(join(root, 'in', 'nuevo', 'a.ts'))
      expect(isInsideReal(join(root, 'in'), realpathLoose(join(root, 'in', 'link', 'f.txt')) as string)).toBe(false)
      const real = realpathLoose(join(root, 'in', 'notas.txt'))
      expect(real).toBe(join(root, 'in', '.env'))
      expect(isSensitiveEither(join(root, 'in', 'notas.txt'), real)).toBe(true)
      expect(realpathLoose('')).toBeNull()
      expect(realpathLoose('a\0b')).toBeNull()
      expect(realDirs([join(root, 'in'), join(root, 'no-existe-nunca', 'x'), 'relativa'])).toEqual([join(root, 'in')])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
