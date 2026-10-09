/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos): las skills de oficina funcionan DENTRO del perfil de Tareas con
 * el Python incluido en la app (`resources/python-bin`): crear un .docx, verificarlo y renderizarlo con LibreOffice
 * (si está instalado). Se omite si no hay Python incluido (checkout sin `npm run fetch:python`). Solo macOS.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSandboxProfile } from './sandbox-profile'
import { macOnly } from '../../test/platform'

const ROOT = process.cwd()
const PYTHON = join(ROOT, 'resources', 'python-bin', `mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}`, 'python', 'bin', 'python3')
const SCRIPTS = join(ROOT, 'resources', 'opencode', 'skills', 'docx', 'scripts')
const HAS_PY = existsSync(PYTHON)
const HAS_LO = existsSync('/Applications/LibreOffice.app/Contents/MacOS/soffice')

describe.skipIf(!macOnly || !HAS_PY)('Seatbelt real: skills de oficina con el Python incluido', () => {
  let dir: string
  let folder: string
  let profile: string

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-office-')))
    folder = join(dir, 'trabajo con espacio')
    mkdirSync(folder, { recursive: true })
    mkdirSync(join(dir, 'p'), { recursive: true })
    profile = buildSandboxProfile({ folder, privateDir: join(dir, 'p'), home: join(dir, 'home') })
    writeFileSync(join(folder, 'c.json'), JSON.stringify({ title: 'Prueba', blocks: [{ type: 'paragraph', text: 'Hola' }] }))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const run = (cmd: string[]) => {
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, ...cmd], {
      encoding: 'utf8',
      cwd: folder,
      timeout: 180000,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: join(dir, 'home'),
        TMPDIR: join(dir, 'p'),
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONNOUSERSITE: '1',
        LAZUNOX_PYTHON: PYTHON
      }
    })
    return { out: `${r.stdout}${r.stderr}`.trim(), status: r.status }
  }

  it('el Python incluido arranca y ve sus bibliotecas dentro del sandbox', () => {
    const r = run([PYTHON, '-c', 'import docx, openpyxl, pptx, pypdf, lxml, PIL; print("ok-libs")'])
    expect(r.out).toContain('ok-libs')
  })

  it('build_docx crea el documento en la carpeta y check_docx lo valida', () => {
    const b = run([PYTHON, join(SCRIPTS, 'build_docx.py'), 'c.json', 'salida.docx'])
    expect(b.status, b.out).toBe(0)
    expect(existsSync(join(folder, 'salida.docx'))).toBe(true)
    const c = run([PYTHON, join(SCRIPTS, 'check_docx.py'), 'salida.docx', '--no-render'])
    expect(c.status, c.out).toBe(0)
  })

  // LÍMITE VERIFICADO: LibreOffice NO arranca dentro de este perfil (necesita `mach-lookup` de LaunchServices y red local, que
  // el perfil deniega a propósito). Lo que se garantiza es que falla LIMPIO: aviso claro, sin dejar rastros en la carpeta.
  it.skipIf(!HAS_LO)('LibreOffice no puede renderizar dentro del sandbox, pero falla con un aviso claro y sin ensuciar la carpeta', () => {
    const r = run([PYTHON, join(ROOT, 'resources', 'opencode', 'skills', '_shared', 'render.py'), 'salida.docx', '--outdir', 'render'])
    const j = JSON.parse(r.out.split('\n').pop() ?? '{}')
    expect(j.ok, r.out).toBe(false)
    expect(j.avisos.join(' ')).toMatch(/Sandbox/)
    expect(existsSync(join(folder, 'render', '.lo-profile'))).toBe(false)
  })
})
