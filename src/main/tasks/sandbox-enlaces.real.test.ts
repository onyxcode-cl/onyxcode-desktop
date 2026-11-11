/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos): una tarea NO puede usar enlaces simbólicos para que el proceso principal (que
 * corre FUERA del encierro) o el SIGUIENTE arranque hagan lo que el encierro le niega (1.8.18). Tres ataques, cada uno preparado desde
 * DENTRO del encierro con el perfil real (HOME de prueba):
 *  1. Vaciar y borrar la carpeta privada (`userData/tasks-sandbox/<clave>`) y poner en su lugar un enlace a la carpeta personal: en el
 *     siguiente arranque el perfil concedía lectura y escritura sobre el destino (`~/.ssh`, `~/.zshrc`…). Ahora el perfil niega borrar o
 *     renombrar la carpeta privada, sus subcarpetas fijas y la carpeta de la tarea, y `seatbeltBackend.prepare` quita un enlace que
 *     ya estuviera (dejado por una versión anterior) y crea una carpeta real.
 *  2. Enlaces en `cache/opencode` (`models.json` → un archivo del usuario, `bin` → otra carpeta): el sembrado del proceso principal
 *     sobrescribía el archivo o dejaba un `rg` ejecutable en la carpeta elegida. Desde la corrección tras la revisión 1 el proceso
 *     principal ya no escribe en la caché privada (el catálogo va a la config de la app, de solo lectura para la tarea).
 *  3. `.lazunox/memoria.md` (o `.lazunox`) como enlace: el proceso principal leía el destino (al prompt, al modelo) y lo sobrescribía.
 *  4. (Corrección tras la revisión 1) `.lazunox`, `.lazunox/trabajo`, `descargas` y `grabaciones` no se pueden renombrar ni borrar
 *     desde dentro (`mv`, `rmdir`, `rm -r` dan error), pero su contenido sí, como antes.
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
import { seedConfigModels } from './models-cache'
import { ensureTaskAppDirs } from './private-dir'
import { getMemory, saveMemory } from './projects'
import { buildSandboxProfile, sandboxDirs, sandboxEnv, TASK_APP_DIRS } from './sandbox-profile'

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
    // Caché del servidor principal (lo que `seedConfigModels` copia a la config): catálogo y `bin/rg`.
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

  describe('2. sembrado: el proceso principal ya no escribe en la carpeta privada (corrección tras la revisión 1)', () => {
    it('con `models.json` y `bin` como enlaces dejados desde dentro, el arranque no escribe nada ni en ellos ni en su destino', () => {
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
      // Arranque normal: `prepare` y, en `launch`, el catálogo va a la config de la app (`seedConfigModels`), no a la caché privada.
      seatbeltBackend.prepare!({ privateDir, userData })
      const catalog = seedConfigModels(join(userData, 'opencode-config'))
      expect(catalog).toBe(join(userData, 'opencode-config', 'catalogo', 'models.json'))
      expect(readFileSync(catalog!, 'utf8')).toBe('{"catalogo":true}')
      expect(readFileSync(victim, 'utf8')).toBe('DOCUMENTO IMPORTANTE\n')
      expect(readdirSync(victimDir)).toEqual([])
      // Lo que dejó la tarea en su caché queda como lo dejó (es suyo): el proceso principal no lo toca.
      expect(lstatSync(join(privateDir, 'cache', 'opencode', 'models.json')).isSymbolicLink()).toBe(true)
      expect(inside(`rm -rf "$P/cache/opencode" && echo LIMPIO`)).toContain('LIMPIO')
    })

    it('desde dentro el catálogo de la config se puede leer pero no escribir', () => {
      const catalog = seedConfigModels(join(userData, 'opencode-config'))!
      const out = inside(`cat "${catalog}"; echo pisado > "${catalog}" && echo ESCRIBE-CATALOGO; echo fin`)
      expect(out).toContain('{"catalogo":true}')
      expect(out).toContain('fin')
      expect(out).not.toContain('ESCRIBE-CATALOGO')
    })
  })

  describe('3. la memoria de la tarea como enlace', () => {
    it('.lazunox/memoria.md → un archivo de fuera: no se lee para el prompt ni se escribe a través del enlace', () => {
      const secret = join(fuera, 'secreto.txt')
      writeFileSync(secret, 'SECRETO-MEMORIA\n')
      const out = inside(`ln -s "${secret}" .lazunox/memoria.md && echo LINK-OK; cat .lazunox/memoria.md 2>&1 | head -1`)
      expect(out).toContain('LINK-OK')
      expect(out).not.toContain('SECRETO-MEMORIA')
      expect(getMemory(folder).content).not.toContain('SECRETO-MEMORIA')
      expect(() => saveMemory(folder, 'pisado')).toThrow(t('merr.projects.memoryLink'))
      expect(readFileSync(secret, 'utf8')).toBe('SECRETO-MEMORIA\n')
    })

    it('.lazunox → una carpeta de fuera: tampoco se lee ni se escribe ahí', () => {
      const f2 = join(dir, 'tarea2')
      mkdirSync(f2, { recursive: true })
      writeFileSync(join(fuera, 'memoria.md'), 'SECRETO-CARPETA\n')
      const r = spawnSync(
        '/usr/bin/sandbox-exec',
        [
          '-p',
          buildSandboxProfile({ folder: f2, privateDir, userData, home }),
          '/bin/sh',
          '-c',
          `ln -s "${fuera}" .lazunox && echo LINK-OK`
        ],
        {
          cwd: f2,
          env: { PATH: '/usr/bin:/bin', HOME: home },
          encoding: 'utf8'
        }
      )
      expect(`${r.stdout}${r.stderr}`).toContain('LINK-OK')
      expect(getMemory(f2).content).not.toContain('SECRETO-CARPETA')
      expect(() => saveMemory(f2, 'pisado')).toThrow(t('merr.projects.memoryLink'))
      expect(readFileSync(join(fuera, 'memoria.md'), 'utf8')).toBe('SECRETO-CARPETA\n')
    })
  })

  describe('4. carpetas de la app en la carpeta de la tarea (corrección tras la revisión 1)', () => {
    const appDirs = (): string[] => TASK_APP_DIRS.map((d) => join(folder, d))

    it.each([false, true])('`mv`, `rmdir` y `rm -r` sobre cada una dan error (Permitir borrar = %s)', (allowDelete) => {
      ensureTaskAppDirs(folder)
      writeFileSync(join(folder, '.lazunox', 'trabajo', 'descargas', 'd.txt'), 'x')
      // De la más profunda a la menos: así cada orden encuentra su carpeta en su sitio.
      const script = [...appDirs()]
        .reverse()
        .map(
          (d, i) => `mv "${d}" "${d}.x" && echo "MV-OK-${i}"; rmdir "${d}" 2>/dev/null && echo "RMDIR-OK-${i}"; rm -r "${d}" 2>/dev/null && echo "RMR-OK-${i}"`
        )
        .join('\n')
      const out = inside(`${script}\necho fin`, allowDelete)
      expect(out).toContain('fin')
      expect(out).not.toMatch(/MV-OK|RMDIR-OK|RMR-OK/)
      for (const d of appDirs()) {
        expect(isRealDir(d)).toBe(true)
        expect(existsSync(`${d}.x`)).toBe(false)
      }
    })

    it.each([false, true])('dentro de `.lazunox/trabajo` se sigue pudiendo crear, renombrar y borrar (Permitir borrar = %s)', (allowDelete) => {
      ensureTaskAppDirs(folder)
      const out = inside(
        `cd .lazunox/trabajo && mkdir -p sub/a && echo x > sub/a/f.txt && mv sub/a sub/b && mv sub/b/f.txt sub/b/g.txt && rm sub/b/g.txt && rm -r sub && echo T-OK
cd descargas && echo d > d1.txt && mv d1.txt d2.txt && rm d2.txt && mkdir s && rmdir s && echo D-OK
cd ../grabaciones && mkdir -p r1 && touch r1/p.png && rm -r r1 && echo G-OK`,
        allowDelete
      )
      expect(out).toContain('T-OK')
      expect(out).toContain('D-OK')
      expect(out).toContain('G-OK')
      for (const d of appDirs()) expect(isRealDir(d)).toBe(true)
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
