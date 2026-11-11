/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos): una tarea NO puede usar enlaces simbólicos para que el proceso principal (que
 * corre FUERA del encierro) o el SIGUIENTE arranque hagan lo que el encierro le niega (1.8.18). Tres ataques, cada uno preparado desde
 * DENTRO del encierro con el perfil real (HOME de prueba):
 *  1. Vaciar y borrar la carpeta privada (`userData/tasks-sandbox/<clave>`) y poner en su lugar un enlace a la carpeta personal: en el
 *     siguiente arranque el perfil concedía lectura y escritura sobre el destino (`~/.ssh`, `~/.zshrc`…). Ahora el perfil niega borrar o
 *     renombrar la carpeta privada, sus subcarpetas fijas y la carpeta de la tarea, y `seatbeltBackend.prepare` quita un enlace que
 *     ya estuviera (dejado por una versión anterior) y crea una carpeta real.
 *  2. Enlaces en `cache/opencode` (`models.json` → un archivo del usuario, `bin` → otra carpeta): el sembrado del proceso principal
 *     sobrescribía el archivo o dejaba un `rg` ejecutable en la carpeta elegida.
 *  3. `.lazunox/memoria.md` (o `.lazunox`) como enlace: el proceso principal leía el destino (al prompt, al modelo) y lo sobrescribía.
 * Y lo normal sigue: «Permitir borrar» dentro de la carpeta, la segunda tarea reutiliza la carpeta privada, el sembrado normal.
 * Todo en una carpeta temporal; el «afuera» es `userData/fuera` (el perfil niega leerlo y escribirlo desde dentro). Solo macOS.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { t } from '@shared/i18n'
import { seatbeltBackend } from './backends/seatbelt'
import { seedModelsCache } from './models-cache'
import { getMemory, saveMemory } from './projects'
import { buildSandboxProfile, sandboxDirs, sandboxEnv } from './sandbox-profile'

const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec')
const KEY = '0123456789abcdef'

describe.skipIf(!HAS_SBX)('Seatbelt real: enlaces en la carpeta privada y en la carpeta de la tarea', () => {
  let dir: string
  let home: string
  let userData: string
  let privateDir: string
  let folder: string
  let fuera: string
  let mainCache: string
  const prevXdg = process.env.XDG_CACHE_HOME

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-enlaces-')))
    home = join(dir, 'home')
    userData = join(dir, 'ud')
    state.userData = userData
    privateDir = join(userData, 'tasks-sandbox', KEY)
    folder = join(dir, 'tarea')
    fuera = join(userData, 'fuera')
    mkdirSync(join(home, '.ssh'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'id_rsa'), 'SECRETO-SSH\n')
    writeFileSync(join(home, '.zshrc'), 'original\n')
    mkdirSync(fuera, { recursive: true })
    mkdirSync(join(userData, 'opencode-config'), { recursive: true })
    mkdirSync(join(folder, '.lazunox', 'trabajo'), { recursive: true })
    // Caché del servidor principal (lo que `seedModelsCache` copia): catálogo y `bin/rg`.
    const xdg = join(dir, 'xdg-cache')
    mainCache = join(xdg, 'opencode')
    mkdirSync(join(mainCache, 'bin'), { recursive: true })
    writeFileSync(join(mainCache, 'models.json'), '{"catalogo":true}')
    writeFileSync(join(mainCache, 'bin', 'rg'), '#!/bin/sh\necho rg\n')
    process.env.XDG_CACHE_HOME = xdg
    seatbeltBackend.prepare!({ privateDir, userData })
  })

  afterAll(() => {
    if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = prevXdg
    rmSync(dir, { recursive: true, force: true })
  })

  /** Perfil de una tarea normal (las opciones de `seatbeltProfileText`) con HOME de prueba. */
  const profile = (allowDelete = false): string =>
    buildSandboxProfile({
      folder,
      privateDir,
      userData,
      readOnly: [join(userData, 'opencode-config')],
      allowedOutboundPorts: [61901],
      serverPort: 61900,
      allowDelete,
      home
    })

  const inside = (script: string, allowDelete = false): string => {
    const env = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      LANG: 'en_US.UTF-8',
      ...sandboxEnv(sandboxDirs(privateDir)),
      P: privateDir
    }
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', profile(allowDelete), '/bin/sh', '-c', script], {
      cwd: folder,
      env,
      encoding: 'utf8',
      timeout: 60000
    })
    return `${r.stdout}${r.stderr}`
  }

  const isRealDir = (p: string): boolean => {
    const st = lstatSync(p)
    return st.isDirectory() && !st.isSymbolicLink()
  }

  describe('1. carpeta privada cambiada por un enlace', () => {
    it.each([false, true])('desde dentro no se puede borrar ni renombrar la carpeta privada (Permitir borrar = %s)', (allowDelete) => {
      const out = inside(
        `for d in config data cache state tmp; do rm -rf "$P/$d" 2>/dev/null; done
rmdir "$P" && echo RMDIR-OK
mv "$P" "$P.x" && echo MV-OK
ln -s "$HOME" "$P" && echo LN-OK
echo fin`,
        allowDelete
      )
      expect(out).toContain('fin')
      expect(out).not.toContain('RMDIR-OK')
      expect(out).not.toContain('MV-OK')
      expect(isRealDir(privateDir)).toBe(true)
      expect(existsSync(`${privateDir}.x`)).toBe(false)
      seatbeltBackend.prepare!({ privateDir, userData }) // vuelve a dejar las subcarpetas que se hayan podido borrar
    })

    it('desde dentro no se pueden renombrar las subcarpetas fijas ni la carpeta de la tarea (con «Permitir borrar»)', () => {
      const out = inside(
        `for d in config data cache state tmp; do mv "$P/$d" "$P/$d.x" && echo "MV-$d-OK"; done
mv "${folder}" "${folder}.x" && echo MV-CARPETA-OK
rmdir "${folder}" && echo RMDIR-CARPETA-OK
echo fin`,
        true
      )
      expect(out).toContain('fin')
      expect(out).not.toMatch(/MV-\w+-OK|RMDIR-CARPETA-OK/)
      for (const d of ['config', 'data', 'cache', 'state', 'tmp']) expect(isRealDir(join(privateDir, d))).toBe(true)
      expect(isRealDir(folder)).toBe(true)
    })

    it('con un enlace ya puesto (de una versión anterior), el siguiente arranque NO concede el destino: se quita el enlace', () => {
      rmSync(privateDir, { recursive: true, force: true })
      symlinkSync(home, privateDir)
      seatbeltBackend.prepare!({ privateDir, userData })
      expect(isRealDir(privateDir)).toBe(true)
      expect(realpathSync(privateDir)).toBe(join(realpathSync(userData), 'tasks-sandbox', KEY))
      // El destino no se tocó: ni se crearon las subcarpetas de la carpeta privada en el HOME ni se borró nada.
      expect(readdirSync(home).sort()).toEqual(['.ssh', '.zshrc'])
      const prof = profile()
      expect(prof).not.toContain(`(subpath "${home}")`)
      const out = inside(`cat "$HOME/.ssh/id_rsa"; echo pwned >> "$HOME/.zshrc"; echo fin`)
      expect(out).toContain('fin')
      expect(out).not.toContain('SECRETO-SSH')
      expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('original\n')
    })

    it('si `tasks-sandbox` es un enlace no se arranca: error claro y nada se crea en el destino', () => {
      const other = join(dir, 'ud2')
      const otherTarget = join(dir, 'destino-ud2')
      mkdirSync(other, { recursive: true })
      mkdirSync(otherTarget, { recursive: true })
      symlinkSync(otherTarget, join(other, 'tasks-sandbox'))
      expect(() => seatbeltBackend.prepare!({ privateDir: join(other, 'tasks-sandbox', KEY), userData: other })).toThrow(
        t('merr.task.privateDirUnsafe')
      )
      expect(readdirSync(otherTarget)).toEqual([])
    })
  })

  describe('2. sembrado del proceso principal con enlaces dentro de la carpeta privada', () => {
    it('models.json y bin como enlaces: no se sobrescribe el archivo del usuario ni aparece rg en la carpeta elegida', () => {
      const victim = join(fuera, 'importante.txt')
      const victimDir = join(fuera, 'carpeta-elegida')
      writeFileSync(victim, 'DOCUMENTO IMPORTANTE\n')
      mkdirSync(victimDir, { recursive: true })
      const old = new Date(Date.now() - 30 * 86_400_000)
      utimesSync(victim, old, old)
      const out = inside(
        `cd "$P/cache" && rm -rf opencode && mkdir opencode && ln -s "${victim}" opencode/models.json && ln -s "${victimDir}" opencode/bin && echo LINKS-OK
cat "${victim}" 2>&1 | head -1
echo x > "${victimDir}/desde-dentro" 2>/dev/null && echo ESCRIBE-FUERA`
      )
      expect(out).toContain('LINKS-OK') // los enlaces se crean desde dentro
      expect(out).not.toContain('DOCUMENTO IMPORTANTE') // y su destino no se lee desde dentro
      expect(out).not.toContain('ESCRIBE-FUERA')
      // Arranque normal: `prepare` (que siembra) y luego `launch` vuelve a sembrar; aquí se llama al sembrado tal cual.
      seatbeltBackend.prepare!({ privateDir, userData })
      seedModelsCache(join(privateDir, 'cache'))
      expect(readFileSync(victim, 'utf8')).toBe('DOCUMENTO IMPORTANTE\n')
      expect(readdirSync(victimDir)).toEqual([])
      // El sembrado quedó bien hecho, en archivos y carpetas reales dentro de la carpeta privada.
      const oc = join(privateDir, 'cache', 'opencode')
      expect(lstatSync(join(oc, 'models.json')).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(oc, 'models.json'), 'utf8')).toBe('{"catalogo":true}')
      expect(isRealDir(join(oc, 'bin'))).toBe(true)
      expect(lstatSync(join(oc, 'bin', 'rg')).mode & 0o111).not.toBe(0)
    })

    it('rg como enlace a un archivo de fuera: no se sobrescribe ese archivo', () => {
      const victim = join(fuera, 'otro.txt')
      writeFileSync(victim, 'NO TOCAR\n')
      const out = inside(`rm -f "$P/cache/opencode/bin/rg" && ln -s "${victim}" "$P/cache/opencode/bin/rg" && echo LINK-OK`)
      expect(out).toContain('LINK-OK')
      seedModelsCache(join(privateDir, 'cache'))
      expect(readFileSync(victim, 'utf8')).toBe('NO TOCAR\n')
    })
  })

  describe('lo normal sigue', () => {
    it('«Permitir borrar» sigue funcionando dentro de la carpeta (y sin él, no)', () => {
      writeFileSync(join(folder, 'borrame.txt'), 'x')
      expect(inside(`rm borrame.txt && echo RM-OK`, false)).not.toContain('RM-OK')
      expect(existsSync(join(folder, 'borrame.txt'))).toBe(true)
      expect(inside(`rm borrame.txt && mkdir sub && touch sub/a && mv sub sub2 && rm -r sub2 && echo RM-OK`, true)).toContain('RM-OK')
      expect(existsSync(join(folder, 'borrame.txt'))).toBe(false)
      // El trabajo de la tarea dentro de su carpeta privada (el motor borra y renombra en su caché y su tmp) sigue igual.
      expect(
        inside(
          `mkdir -p "$P/tmp/a" && touch "$P/tmp/a/f" && mv "$P/tmp/a" "$P/tmp/b" && rm -r "$P/tmp/b" && rm -rf "$P/cache/opencode" && echo PRIV-OK`
        )
      ).toContain('PRIV-OK')
    })

    it('una segunda tarea en la misma carpeta reutiliza su carpeta privada (no se recrea ni se vacía)', () => {
      seatbeltBackend.prepare!({ privateDir, userData })
      writeFileSync(join(privateDir, 'data', 'marca'), 'sigo aqui')
      seatbeltBackend.prepare!({ privateDir, userData })
      expect(readFileSync(join(privateDir, 'data', 'marca'), 'utf8')).toBe('sigo aqui')
      expect(readFileSync(join(privateDir, 'cache', 'opencode', 'models.json'), 'utf8')).toBe('{"catalogo":true}')
    })

    it('la memoria normal se guarda y se lee', () => {
      const f3 = join(dir, 'tarea3')
      mkdirSync(f3, { recursive: true })
      expect(saveMemory(f3, 'nota normal').content).toBe('nota normal')
      expect(getMemory(f3)).toMatchObject({ content: 'nota normal', exists: true })
      expect(lstatSync(join(f3, '.lazunox', 'memoria.md')).isFile()).toBe(true)
    })
  })
})
