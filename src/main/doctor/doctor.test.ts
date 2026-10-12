import { describe, expect, it } from 'vitest'
import { runDoctor, type DoctorDeps } from './doctor'

const GB = 1024 ** 3
const base = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  platform: 'darwin',
  osRelease: '24.0.0',
  computer: async () => ({ helperOk: true, accessibility: true, screenRecording: true, screens: [{ width: 1920, height: 1080 }] }),
  run: async (file) =>
    file.endsWith('cu-keys')
      ? { code: 0, out: '{"layout":"com.apple.keylayout.US","chars":150}' }
      : file.endsWith('python3')
        ? { code: 0, out: 'ok-libs\n' }
        : { code: 0, out: '/Library/Developer/CommandLineTools' },
  exists: () => true,
  keysBin: '/app/computer-use/bin/cu-keys',
  pythonBin: '/app/python/bin/python3',
  office: () => ({ state: 'installed', source: 'app', version: '26.8.1' }),
  freeBytes: () => 50 * GB,
  ...over
})
const level = (r: Awaited<ReturnType<typeof runDoctor>>, id: string): string | undefined => r.items.find((i) => i.id === id)?.level

describe('doctor', () => {
  it('Mac en orden: todo ok', async () => {
    const r = await runDoctor(base(), () => 1)
    expect(r.overall).toBe('ok')
    expect(r.at).toBe(1)
    expect(r.items.filter((i) => i.level === 'fail' || i.level === 'warn')).toEqual([])
  })

  it('Mac recién instalado: faltan permisos, LibreOffice y las herramientas de Apple; cada fallo trae su botón', async () => {
    const r = await runDoctor(
      base({
        computer: async () => ({ helperOk: true, accessibility: false, screenRecording: false, screens: [] }),
        office: () => ({ state: 'missing', sizeBytes: 299e6 }),
        run: async (file) =>
          file.endsWith('xcode-select')
            ? { code: 2, out: 'xcode-select: error: unable to get active developer directory' }
            : { code: 0, out: 'ok-libs "layout"' }
      })
    )
    expect(r.overall).toBe('fail')
    expect(level(r, 'accessibility')).toBe('fail')
    expect(r.items.find((i) => i.id === 'accessibility')?.fix).toBe('requestPermissions')
    expect(r.items.find((i) => i.id === 'screenRecording')?.fix).toBe('requestPermissions')
    expect(r.items.find((i) => i.id === 'office')).toMatchObject({ level: 'warn', fix: 'installOffice' })
    expect(r.items.find((i) => i.id === 'git')).toMatchObject({ level: 'warn', fix: 'xcodeSelect' })
  })

  it('la herramienta de teclado muestra la distribución en lenguaje llano, no el JSON', async () => {
    const r = await runDoctor(base())
    expect(r.items.find((i) => i.id === 'keyboardTool')?.detail).toBe('Distribución: US')
  })

  it('solo avisos (sin fallos): overall = warn', async () => {
    const r = await runDoctor(base({ office: () => ({ state: 'missing', sizeBytes: 1e6 }) }))
    expect(r.overall).toBe('warn')
  })

  it('macOS demasiado antiguo es un fallo', async () => {
    expect(level(await runDoctor(base({ osRelease: '21.6.0' })), 'macos')).toBe('fail')
    expect(level(await runDoctor(base({ osRelease: '22.1.0' })), 'macos')).toBe('ok')
  })

  it('cu-keys ausente o que no arranca: aviso (el teclado remoto cae al método anterior), no fallo', async () => {
    expect(level(await runDoctor(base({ exists: (p) => !p.endsWith('cu-keys') })), 'keyboardTool')).toBe('warn')
    expect(
      level(
        await runDoctor(base({ run: async (f) => (f.endsWith('cu-keys') ? { code: 1, out: '' } : { code: 0, out: 'ok-libs' }) })),
        'keyboardTool'
      )
    ).toBe('warn')
  })

  it('Python incluido roto es un fallo; ausente, un aviso', async () => {
    expect(
      level(
        await runDoctor(
          base({ run: async (f) => (f.endsWith('python3') ? { code: 1, out: 'ModuleNotFoundError: docx' } : { code: 0, out: '"layout"' }) })
        ),
        'python'
      )
    ).toBe('fail')
    expect(level(await runDoctor(base({ pythonBin: null })), 'python')).toBe('warn')
  })

  it('poco disco libre: aviso con los GB', async () => {
    const r = await runDoctor(base({ freeBytes: () => 1 * GB }))
    expect(r.items.find((i) => i.id === 'disk')).toMatchObject({ level: 'warn', detail: '1 GB libres' })
  })

  it('si el control del Mac falla al consultarse no rompe el doctor; fuera de macOS no hay comprobaciones de macOS', async () => {
    const r1 = await runDoctor(
      base({
        computer: async () => {
          throw new Error('x')
        }
      })
    )
    expect(r1.items.some((i) => i.id === 'accessibility')).toBe(false)
    const r2 = await runDoctor(base({ platform: 'win32', keysBin: null, office: () => ({ state: 'unsupported' }) }))
    expect(r2.items.some((i) => i.id === 'macos' || i.id === 'git')).toBe(false)
  })

  it('no ejecuta git (en un Mac sin herramientas de Apple abriría un instalador): solo xcode-select', async () => {
    const calls: string[] = []
    await runDoctor(base({ run: async (f) => (calls.push(f), { code: 0, out: 'ok-libs "layout"' }) }))
    expect(calls.some((c) => c.endsWith('/git'))).toBe(false)
    expect(calls).toContain('/usr/bin/xcode-select')
  })
})

describe('revisión visual con ArtCraft', () => {
  it('sin LibreOffice pero con ArtCraft instalado no avisa de LibreOffice', async () => {
    const r = await runDoctor(base({ office: () => ({ state: 'missing', sizeBytes: 299e6 }), artcraft: () => true }))
    expect(r.items.find((i) => i.id === 'office')).toBeUndefined()
  })
  it('sin LibreOffice ni ArtCraft sigue avisando', async () => {
    const r = await runDoctor(base({ office: () => ({ state: 'missing', sizeBytes: 299e6 }), artcraft: () => false }))
    expect(r.items.find((i) => i.id === 'office')).toMatchObject({ level: 'warn', fix: 'installOffice' })
  })
})
