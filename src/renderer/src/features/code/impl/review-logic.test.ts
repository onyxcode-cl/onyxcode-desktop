import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN_PX,
  acceptEntries,
  acceptFilesIn,
  acceptSessionIn,
  deriveSessionState,
  matchesSessionFilter,
  fingerprint,
  isAccepted,
  panelLayout,
  parseReviewed,
  pathOfDiffHeader,
  pendingPaths,
  sessionNeedsReview,
  splitPatchByFile,
  summarySignature,
  trimReviewed,
  type ReviewRecord
} from './review-logic'

const none = { waiting: false, busy: false, unread: false, needsReview: false }

describe('deriveSessionState', () => {
  it('sin nada pendiente no hay punto (reposo)', () => {
    expect(deriveSessionState(none)).toBeNull()
  })
  it('cada estado por separado', () => {
    expect(deriveSessionState({ ...none, waiting: true })).toBe('waiting')
    expect(deriveSessionState({ ...none, busy: true })).toBe('working')
    expect(deriveSessionState({ ...none, needsReview: true })).toBe('review')
    expect(deriveSessionState({ ...none, unread: true })).toBe('done')
  })
  it('prioridad: esperando > trabajando > por revisar > sin leer', () => {
    const all = { waiting: true, busy: true, unread: true, needsReview: true }
    expect(deriveSessionState(all)).toBe('waiting')
    expect(deriveSessionState({ ...all, waiting: false })).toBe('working')
    expect(deriveSessionState({ ...all, waiting: false, busy: false })).toBe('review')
    expect(deriveSessionState({ ...all, waiting: false, busy: false, needsReview: false })).toBe('done')
  })
})

describe('revisión de la sesión', () => {
  const summary = { files: 2, additions: 10, deletions: 3 }
  it('la huella del resumen es nula sin cambios', () => {
    expect(summarySignature(undefined)).toBeNull()
    expect(summarySignature({ files: 0, additions: 0, deletions: 0 })).toBeNull()
    expect(summarySignature(summary)).toBe('2:10:3')
  })
  it('hay cambios sin revisar hasta aceptar esa misma huella; si el agente edita más, vuelve a pendiente', () => {
    expect(sessionNeedsReview(summary, undefined)).toBe(true)
    const rec = acceptSessionIn(undefined, summarySignature(summary))
    expect(sessionNeedsReview(summary, rec)).toBe(false)
    expect(sessionNeedsReview({ ...summary, additions: 11 }, rec)).toBe(true)
    expect(sessionNeedsReview(undefined, undefined)).toBe(false)
  })
})

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' x',
  '-y',
  '+y2',
  '+z',
  'diff --git a/b with space.md b/b with space.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/b with space.md',
  '@@ -0,0 +1 @@',
  '+hola',
  // Mismo archivo, cambios sin preparar: se junta con el primero.
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -9 +9 @@',
  '-q',
  '+r',
  ''
].join('\n')

describe('splitPatchByFile', () => {
  it('lee la ruta de la cabecera, también con espacios y renombres', () => {
    expect(pathOfDiffHeader('diff --git a/src/a.ts b/src/a.ts')).toBe('src/a.ts')
    expect(pathOfDiffHeader('diff --git a/b with space.md b/b with space.md')).toBe('b with space.md')
    expect(pathOfDiffHeader('diff --git a/old.ts b/new.ts')).toBe('new.ts')
    expect(pathOfDiffHeader('diff --git "a/\\303\\261.ts" "b/\\303\\261.ts"')).toBeNull()
  })
  it('un diff por archivo con sus +/− (preparado y sin preparar se suman)', () => {
    const m = splitPatchByFile(PATCH)
    expect([...m.keys()]).toEqual(['src/a.ts', 'b with space.md'])
    expect(m.get('src/a.ts')).toMatchObject({ additions: 3, deletions: 2 })
    expect(m.get('b with space.md')).toMatchObject({ additions: 1, deletions: 0 })
  })
  it('texto vacío → sin archivos', () => {
    expect(splitPatchByFile('').size).toBe(0)
  })
})

describe('Aceptar archivos', () => {
  const infos = splitPatchByFile(PATCH)
  const paths = ['src/a.ts', 'b with space.md', 'sin-diff.bin']

  it('aceptar guarda la huella del contenido; si el archivo cambia deja de estar aceptado', () => {
    const rec = acceptFilesIn(undefined, acceptEntries(['src/a.ts'], infos))
    expect(isAccepted(rec, 'src/a.ts', infos.get('src/a.ts')?.fingerprint)).toBe(true)
    expect(isAccepted(rec, 'src/a.ts', fingerprint('otro contenido'))).toBe(false)
    expect(isAccepted(rec, 'b with space.md', infos.get('b with space.md')?.fingerprint)).toBe(false)
  })
  it('un archivo sin diff conocido no se puede aceptar (se omite) y sigue pendiente', () => {
    expect(acceptEntries(['sin-diff.bin'], infos)).toEqual({})
    expect(pendingPaths(paths, undefined, infos)).toEqual(paths)
  })
  it('pendientes = rutas no aceptadas con su contenido actual', () => {
    const rec: ReviewRecord = acceptFilesIn(undefined, acceptEntries(paths, infos))
    expect(pendingPaths(paths, rec, infos)).toEqual(['sin-diff.bin'])
  })
  it('acumula sin pisar lo aceptado antes', () => {
    const a = acceptFilesIn(undefined, { x: '1' })
    expect(acceptFilesIn(a, { y: '2' }).files).toEqual({ x: '1', y: '2' })
  })
})

describe('registro persistido', () => {
  it('parseReviewed descarta formas inesperadas', () => {
    expect(parseReviewed(null)).toEqual({})
    expect(parseReviewed('x')).toEqual({})
    expect(parseReviewed({ s1: { sig: '1:2:3', files: { a: 'h', b: 5 } }, s2: 7, s3: { files: 'no' } })).toEqual({
      s1: { sig: '1:2:3', files: { a: 'h' } },
      s3: { files: {} }
    })
  })
  it('trimReviewed conserva las más recientes', () => {
    const all = { a: { files: {} }, b: { files: {} }, c: { files: {} } }
    expect(Object.keys(trimReviewed(all, 2))).toEqual(['b', 'c'])
    expect(trimReviewed(all, 5)).toBe(all)
  })
})

describe('panelLayout (fijo o superposición)', () => {
  it('con espacio: fijo y el centro conserva ≥ 36 rem', () => {
    const l = panelLayout(1280, 460)
    expect(l).toEqual({ mode: 'docked', width: 460 })
    expect(1280 - l.width).toBeGreaterThanOrEqual(CENTER_MIN_PX)
  })
  it('un ancho elegido demasiado grande se recorta para que el centro no baje de 36 rem', () => {
    expect(panelLayout(1000, 880)).toEqual({ mode: 'docked', width: 1000 - CENTER_MIN_PX })
  })
  it('sin espacio para un panel útil: superposición con margen, nunca más ancha que la ventana', () => {
    const l = panelLayout(800, 460)
    expect(l.mode).toBe('overlay')
    expect(l.width).toBeLessThanOrEqual(800)
    expect(panelLayout(320, 460).width).toBeLessThanOrEqual(320)
  })
  it('justo en el umbral', () => {
    expect(panelLayout(CENTER_MIN_PX + 300, 460).mode).toBe('docked')
    expect(panelLayout(CENTER_MIN_PX + 299, 460).mode).toBe('overlay')
  })
  it('sin medida se asume fijo (comportamiento de siempre)', () => {
    expect(panelLayout(0, 460)).toEqual({ mode: 'docked', width: 460 })
  })
})

describe('matchesSessionFilter (píldoras de la barra lateral)', () => {
  const idle = { waiting: false, busy: false, needsReview: false }
  it('Todas deja pasar todo', () => {
    expect(matchesSessionFilter('all', idle)).toBe(true)
  })
  it('Activas = trabajando o esperando', () => {
    expect(matchesSessionFilter('active', idle)).toBe(false)
    expect(matchesSessionFilter('active', { ...idle, busy: true })).toBe(true)
    expect(matchesSessionFilter('active', { ...idle, waiting: true })).toBe(true)
    expect(matchesSessionFilter('active', { ...idle, needsReview: true })).toBe(false)
  })
  it('Cambios = por revisar, aunque ahora mismo esté trabajando', () => {
    expect(matchesSessionFilter('review', idle)).toBe(false)
    expect(matchesSessionFilter('review', { ...idle, needsReview: true })).toBe(true)
    expect(matchesSessionFilter('review', { ...idle, needsReview: true, busy: true })).toBe(true)
    expect(matchesSessionFilter('review', { ...idle, busy: true })).toBe(false)
  })
})
