import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN_PX,
  acceptEntries,
  acceptFilesIn,
  acceptSessionIn,
  deriveSessionState,
  fingerprint,
  isAccepted,
  legacyBaseline,
  panelLayout,
  parseReviewed,
  pathOfDiffHeader,
  pendingPaths,
  sessionNeedsReview,
  splitPatchByFile,
  summarySignature,
  trimReviewed,
  unquoteGitPath,
  withBaseline,
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
  it('migración: sin registro, lo que no se tocó desde que existe el registro se da por revisado', () => {
    const since = 1_000
    expect(sessionNeedsReview(summary, undefined, { updated: 900, since })).toBe(false)
    expect(sessionNeedsReview(summary, undefined, { updated: 1_000, since })).toBe(false)
    // Tocada después (el agente volvió a trabajar): se juzga normal.
    expect(sessionNeedsReview(summary, undefined, { updated: 1_001, since })).toBe(true)
    // Sin «desde» (registro ya existente): todo se juzga normal.
    expect(sessionNeedsReview(summary, undefined, { updated: 900, since: null })).toBe(true)
    // Con registro propio manda el registro, aunque sea antigua.
    expect(sessionNeedsReview(summary, { sig: '1:1:1', files: {} }, { updated: 900, since })).toBe(true)
  })
  it('legacyBaseline fija la huella actual de las sesiones antiguas sin registro, y solo de esas', () => {
    const sessions = [
      { id: 'vieja', time: { updated: 500 }, summary },
      { id: 'nueva', time: { updated: 2_000 }, summary },
      { id: 'sin-cambios', time: { updated: 500 } },
      { id: 'con-registro', time: { updated: 500 }, summary }
    ]
    const reviewed = { 'con-registro': { sig: 'x', files: {} } }
    expect(legacyBaseline(sessions, reviewed, 1_000)).toEqual({ vieja: '2:10:3' })
    expect(legacyBaseline(sessions, reviewed, null)).toEqual({})
  })
  it('withBaseline no pisa registros y pone los de base al principio (el tope los descarta primero)', () => {
    const all = { a: { sig: 'real', files: { 'x.ts': 'h' } } }
    const next = withBaseline(all, { a: 'otra', b: '1:1:0' })
    expect(next.a).toEqual(all.a)
    expect(Object.keys(next)).toEqual(['b', 'a'])
    expect(withBaseline(all, { a: 'otra' })).toBe(all)
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
    // Entre comillas (git cita no ASCII con escapes octales y siempre las comillas dobles): se decodifica.
    expect(pathOfDiffHeader('diff --git "a/\\303\\261.ts" "b/\\303\\261.ts"')).toBe('ñ.ts')
    expect(pathOfDiffHeader('diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"')).toBe('q"uote.txt')
    expect(pathOfDiffHeader('diff --git "a/tab\\there" "b/tab\\there"')).toBe('tab\there')
    expect(pathOfDiffHeader('diff --git "a/b\\\\s" "b/b\\\\s"')).toBe('b\\s')
    expect(pathOfDiffHeader('diff --git a/plain.txt "b/q\\"x.txt"')).toBe('q"x.txt')
    expect(pathOfDiffHeader('diff --git a/café.txt b/café.txt')).toBe('café.txt')
    // Renombre con « b/» ambiguo: no se adivina (lo resuelve el cuerpo del diff).
    expect(pathOfDiffHeader('diff --git a/x b/y b/z b/w')).toBeNull()
    expect(unquoteGitPath('"sin cierre')).toBeNull()
  })
  it('renombres: manda `rename to` sobre la cabecera, aunque haya « b/» en los nombres', () => {
    const p = ['diff --git a/x b/y b/z b/w', 'similarity index 100%', 'rename from x b/y', 'rename to z b/w', ''].join('\n')
    expect([...splitPatchByFile(p).keys()]).toEqual(['z b/w'])
    const q = ['diff --git "a/vie\\"jo" "b/nue\\"vo"', 'similarity index 100%', 'rename from "vie\\"jo"', 'rename to "nue\\"vo"', ''].join(
      '\n'
    )
    expect([...splitPatchByFile(q).keys()]).toEqual(['nue"vo'])
  })
  it('salida real de git (core.quotepath=off): café.txt, nuevo ñ.txt y q"uote.txt casan con las rutas de status', () => {
    const real = [
      'diff --git a/café.txt b/café.txt',
      'index 5626abf..3e8b6d8 100644',
      '--- a/café.txt',
      '+++ b/café.txt',
      '@@ -1 +1,2 @@',
      ' uno',
      '+dos',
      'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
      'index 5626abf..3e8b6d8 100644',
      '--- "a/q\\"uote.txt"',
      '+++ "b/q\\"uote.txt"',
      '@@ -1 +1,2 @@',
      ' uno',
      '+dos',
      'diff --git a/nuevo ñ.txt b/nuevo ñ.txt',
      'new file mode 100644',
      'index 0000000..b1b7161',
      '--- /dev/null',
      '+++ b/nuevo ñ.txt\t',
      '@@ -0,0 +1 @@',
      '+hola',
      ''
    ].join('\n')
    const m = splitPatchByFile(real)
    expect([...m.keys()]).toEqual(['café.txt', 'q"uote.txt', 'nuevo ñ.txt'])
    for (const p of m.keys()) expect(m.get(p)).toMatchObject({ additions: 1, deletions: 0 })
  })
  it('el aviso de archivos omitidos que va detrás del último diff no entra en su huella', () => {
    const one = splitPatchByFile(PATCH).get('b with space.md')!
    const withNotice = splitPatchByFile(`${PATCH}# 3 archivos sin seguimiento adicionales omitidos\n`).get('b with space.md')!
    expect(withNotice.fingerprint).toBe(one.fingerprint)
    expect(withNotice.patch).not.toContain('omitidos')
  })
  it('una línea de contenido que empieza por «---» o «diff» dentro de un bloque no corta el archivo', () => {
    const p = ['diff --git a/m.md b/m.md', '--- a/m.md', '+++ b/m.md', '@@ -1,1 +1,2 @@', ' x', '+--- separador', ''].join('\n')
    expect(splitPatchByFile(p).get('m.md')).toMatchObject({ additions: 1, deletions: 0 })
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
  it('ventana mediana: lado a lado, panel ≤ 26 rem y ≤ 50 % del área (la conversación sigue entera)', () => {
    const l = panelLayout(744, 460)
    expect(l.mode).toBe('split')
    expect(l.width).toBe(372)
    expect(744 - l.width).toBeGreaterThanOrEqual(l.width)
    expect(panelLayout(840, 900)).toEqual({ mode: 'split', width: 416 })
  })
  it('área tan angosta que no caben dos mitades útiles: el panel cubre todo (nada a medias)', () => {
    expect(panelLayout(599, 460)).toEqual({ mode: 'full', width: 599 })
  })
  it('justo en los umbrales', () => {
    expect(panelLayout(CENTER_MIN_PX + 300, 460).mode).toBe('docked')
    expect(panelLayout(CENTER_MIN_PX + 299, 460).mode).toBe('split')
    expect(panelLayout(600, 460).mode).toBe('split')
  })
  it('sin medida se asume fijo (comportamiento de siempre)', () => {
    expect(panelLayout(0, 460)).toEqual({ mode: 'docked', width: 460 })
  })
})
