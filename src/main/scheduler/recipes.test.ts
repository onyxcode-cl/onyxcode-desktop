/**
 * Recetas de Rutinas (F8-B188): cada receta, con las respuestas por omisión (o una de ejemplo), produce una rutina que el
 * validador de verdad acepta: el esquema estricto del IPC `routines:save` y `SchedulerService.saveRoutine` (programación,
 * carpeta, lista de permisos, carpeta vigilada).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getAppPath: () => state.dir, isPackaged: false, getVersion: () => '0' },
  Notification: class {
    static isSupported = (): boolean => false
  },
  powerMonitor: { on: () => undefined, removeListener: () => undefined }
}))

import type { Lang } from '@shared/i18n'
import type { RoutineInput } from '@shared/ipc-tasks'
import { RECIPES, buildRecipeInput, defaultAnswers, textQuestions, type RoutineRecipe } from '@shared/routine-recipes'
import { DEFAULT_SETTINGS } from '@shared/types'
import { IPC_SCHEMAS } from '../ipc/schemas'
import { SchedulerService } from './service'
import type { FsLike, WatchHandle } from './file-watch-manager'

const fakeFs = (): FsLike => ({
  watch: (): WatchHandle => ({ close: () => undefined }),
  realpath: (p: string) => p,
  lstat: () => null,
  list: () => [],
  canOpen: () => true
})

function make(): SchedulerService {
  return new SchedulerService({
    getMainConnection: () => Promise.reject(new Error('sin servidor')),
    chatDirectory: state.dir,
    tasks: { isApproved: () => true } as never,
    getSettings: () => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: true }),
    watchFs: fakeFs(),
    userDataDir: join(state.dir, 'userData')
  })
}

/** Lo que hace el formulario al guardar: la carpeta elegida y, en el disparador por archivo, la vigilada. */
function asSaved(input: RoutineInput, folder: string): RoutineInput {
  const needsFolder = input.mode !== 'chat'
  const schedule = input.schedule.kind === 'file' ? { ...input.schedule, folder: input.schedule.folder || folder } : input.schedule
  return { ...input, folder: needsFolder ? folder : null, schedule }
}

/** Respuestas de ejemplo: las de omisión y, donde una obligatoria no trae valor, un texto cualquiera. */
function sampleAnswers(r: RoutineRecipe, lang: Lang): Record<string, string> {
  const a = defaultAnswers(r, lang)
  for (const q of textQuestions(r)) if (!a[q.id]) a[q.id] = lang === 'es' ? 'respuesta de ejemplo' : 'sample answer'
  return a
}

describe('recetas de Rutinas: producen una rutina válida para el validador existente', () => {
  let work = ''
  beforeEach(() => {
    state.dir = realpathSync(mkdtempSync(join(tmpdir(), 'recipes-')))
    work = join(state.dir, 'trabajo')
    mkdirSync(work)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  for (const lang of ['es', 'en'] as const) {
    for (const recipe of RECIPES) {
      it(`${recipe.id} (${lang}): pasa el esquema del IPC y se guarda`, () => {
        const input = asSaved(buildRecipeInput(recipe, lang, sampleAnswers(recipe, lang), { providerID: 'p', modelID: 'm' }), work)
        // 1) Esquema estricto del canal `routines:save` (claves inesperadas = error).
        expect(() => IPC_SCHEMAS['routines:save'](input, 'req')).not.toThrow()
        // 2) El planificador: programación, carpeta autorizada, permisos y carpeta vigilada.
        const saved = make().saveRoutine(input)
        expect(saved).toMatchObject({ name: recipe.name[lang], mode: recipe.mode, enabled: true, onAsk: 'reject' })
        // Solo Overdrive conserva la lista de permisos; las demás recetas no declaran ninguna.
        expect(saved.allow ?? []).toEqual(recipe.mode === 'tasks' ? recipe.allow : [])
        expect(saved.prompt).not.toMatch(/\{\{ask:/)
        // Ninguna receta pide Control total, sitios extra ni nada fuera de lo declarado.
        expect(saved.fullAccess ?? false).toBe(false)
        expect(saved.allowHosts ?? []).toEqual([])
        if (recipe.schedule.kind === 'file') expect(saved.schedule).toMatchObject({ kind: 'file', folder: work, on: 'create' })
      })
    }
  }

  it('sin elegir carpeta, una receta con carpeta NO se guarda (la persona tiene que elegirla)', () => {
    const svc = make()
    for (const recipe of RECIPES.filter((r) => r.mode !== 'chat')) {
      const input = buildRecipeInput(recipe, 'es', sampleAnswers(recipe, 'es'), { providerID: 'p', modelID: 'm' })
      expect(() => svc.saveRoutine(input), recipe.id).toThrow()
    }
  })

  it('el esquema rechaza que una receta alterada traiga permisos de escritura o claves ajenas', () => {
    const recipe = RECIPES.find((r) => r.mode === 'tasks')!
    const ok = asSaved(buildRecipeInput(recipe, 'es', sampleAnswers(recipe, 'es'), { providerID: 'p', modelID: 'm' }), work)
    expect(() => IPC_SCHEMAS['routines:save']({ ...ok, extra: 1 }, 'req')).toThrow()
    expect(() =>
      IPC_SCHEMAS['routines:save'](
        { ...ok, schedule: { kind: 'file', folder: 'relativa', patterns: [], on: 'create', settleSec: 5, maxPerHour: 3 } },
        'req'
      )
    ).toThrow()
  })
})
