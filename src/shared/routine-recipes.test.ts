import { describe, expect, it } from 'vitest'
import raw from '../../resources/rutinas/recetas.json'
import {
  RECIPES,
  RECIPE_ERRORS,
  RECIPE_ICONS,
  buildRecipeInput,
  cleanAnswer,
  defaultAnswers,
  folderQuestion,
  missingAnswers,
  recipeById,
  textQuestions,
  validateRecipes,
  type Bi
} from './routine-recipes'

/* eslint-disable @typescript-eslint/no-explicit-any */
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(raw))
const model = { providerID: 'p', modelID: 'm' }
const errorsWith = (mut: (c: Record<string, any>) => void): string => {
  const c = clone()
  mut(c)
  return validateRecipes(c).join('\n')
}
const first = (c: Record<string, any>, id: string): Record<string, any> => c.recipes.find((r: { id: string }) => r.id === id)

/** Todo texto visible de las recetas (para las guardias de vocabulario). */
function allText(): string[] {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const r of RECIPES) {
    const { id: _id, icon: _i, audience: _a, mode: _m, schedule: _s, allow: _al, sessionMode: _sm, onAsk: _o, verifiedAt: _v, ...text } = r
    walk(text)
  }
  return out
}

describe('recetas de Rutinas: el archivo empaquetado', () => {
  it('cumple el esquema y ofrece entre 10 y 12 recetas para ambos públicos', () => {
    expect(validateRecipes(raw)).toEqual([])
    expect(RECIPE_ERRORS).toEqual([])
    expect(RECIPES.length).toBeGreaterThanOrEqual(10)
    expect(RECIPES.length).toBeLessThanOrEqual(12)
    expect(RECIPES.some((r) => r.audience === 'everyone')).toBe(true)
    expect(RECIPES.some((r) => r.audience === 'technical')).toBe(true)
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length)
  })

  it('cubre los tres modos y las dos formas de disparar (reloj y archivo nuevo)', () => {
    expect(new Set(RECIPES.map((r) => r.mode))).toEqual(new Set(['chat', 'tasks', 'code']))
    expect(RECIPES.some((r) => r.schedule.kind === 'file')).toBe(true)
    expect(RECIPES.some((r) => r.schedule.kind === 'daily')).toBe(true)
    expect(RECIPES.some((r) => r.schedule.kind === 'weekly')).toBe(true)
  })

  it('todo texto está en español e inglés (paridad) y las variables son las mismas en ambos', () => {
    const pairs: Bi[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (typeof o.es === 'string' || typeof o.en === 'string') pairs.push(o as unknown as Bi)
        else Object.values(o).forEach(walk)
      }
    }
    walk(RECIPES)
    expect(pairs.length).toBeGreaterThan(100)
    for (const p of pairs) {
      expect(typeof p.es === 'string' && p.es.length > 0, JSON.stringify(p)).toBe(true)
      expect(typeof p.en === 'string' && p.en.length > 0, JSON.stringify(p)).toBe(true)
    }
    for (const r of RECIPES) {
      const vars = (s: string): string[] => [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort()
      expect(vars(r.prompt.en), r.id).toEqual(vars(r.prompt.es))
    }
  })

  it('toda receta con carpeta declara su acceso mínimo, pide solo lectura y rechaza lo que no esté previsto', () => {
    for (const r of RECIPES) {
      expect(r.onAsk, r.id).toBe('reject')
      expect(r.doesNot.length, r.id).toBeGreaterThan(0)
      if (r.mode === 'chat') {
        expect(r.access.level).toBe('none')
        expect(r.allow).toEqual([])
        expect(folderQuestion(r)).toBeUndefined()
      } else {
        expect(r.access.level, r.id).toBe(r.mode === 'tasks' ? 'read-folder' : 'read-project')
        expect(folderQuestion(r), r.id).toBeDefined()
        for (const a of r.allow) expect(['read', 'list', 'glob', 'grep', 'bash'], r.id).toContain(a.permission)
        expect(
          r.allow.some((a) => /edit|write|rm|mv|mkdir|push|commit/.test(`${a.permission} ${a.pattern}`)),
          r.id
        ).toBe(false)
      }
    }
  })

  it('las recetas que podrían cambiar cosas solo proponen y dejan el resultado en la respuesta (bandeja)', () => {
    const ordenar = recipeById('descargas-ordenar')!
    expect(ordenar.prompt.es).toMatch(/SOLO PROPONES/)
    expect(ordenar.prompt.en).toMatch(/YOU ONLY PROPOSE/)
    for (const r of RECIPES.filter((x) => x.mode !== 'chat')) {
      expect(r.prompt.es, r.id).toMatch(/respuesta final/)
      expect(r.prompt.en, r.id).toMatch(/final reply/)
      expect(r.prompt.es, r.id).toMatch(/no (modifiques|cambies|muevas|borres)/i)
    }
  })

  it('el vocabulario es llano y no nombra productos de terceros', () => {
    const text = allText().join('\n')
    expect(text).not.toMatch(/Claude|Anthropic|OpenAI|Codex|ChatGPT|Gemini/)
    expect(text).not.toMatch(/proveedor|entregable|Modo auto|servidor MCP|\bMCP\b|API key/i)
    expect(text).not.toMatch(/\bprovider\b|deliverable|MCP server|\bcron\b/i)
    // Jerga que una persona sin conocimientos técnicos no entiende, salvo en las recetas para quien programa.
    for (const r of RECIPES.filter((x) => x.audience === 'everyone')) {
      const t = JSON.stringify([r.title, r.description, r.does, r.doesNot, r.access, r.dataNote, r.questions])
      expect(t, r.id).not.toMatch(/\b(git|commit|token|prompt|script|API|JSON|regex)\b/i)
    }
  })

  it('sin secretos, rutas personales ni direcciones en las recetas', () => {
    const text = JSON.stringify(raw)
    expect(text).not.toMatch(/\/Users\/|C:\\\\|sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{12,}/)
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('los íconos usados están en la lista permitida', () => {
    for (const r of RECIPES) expect(RECIPE_ICONS).toContain(r.icon)
  })
})

describe('recetas de Rutinas: el validador rechaza lo que promete sin respaldo', () => {
  it('rechaza claves desconocidas, ids repetidos y versión distinta', () => {
    expect(errorsWith((c) => (c.extra = 1))).toMatch(/clave desconocida/)
    expect(errorsWith((c) => (c.recipes[1].id = c.recipes[0].id))).toMatch(/id repetido/)
    expect(errorsWith((c) => (c.schema = 2))).toMatch(/schema/)
    expect(errorsWith((c) => (first(c, 'repo-estado').surprise = true))).toMatch(/clave desconocida/)
  })

  it('exige español e inglés, y no acepta un inglés copiado del español', () => {
    expect(errorsWith((c) => delete first(c, 'noticias-diarias').title.en)).toMatch(/falta el texto/)
    expect(errorsWith((c) => (first(c, 'noticias-diarias').description.en = first(c, 'noticias-diarias').description.es))).toMatch(
      /idéntico/
    )
  })

  it('no deja presentar como acción de la receta mover, borrar, enviar, comprar ni publicar', () => {
    for (const verb of [
      'Mueve tus archivos a otra carpeta.',
      'Borra los duplicados.',
      'Envía un correo con el resumen.',
      'Compra lo que falte.',
      'Publica el resumen.'
    ]) {
      expect(errorsWith((c) => first(c, 'descargas-resumen').does.push({ es: verb, en: 'Does a thing for you in your folder.' }))).toMatch(
        /promete una acción/
      )
    }
    expect(
      errorsWith((c) =>
        first(c, 'descargas-resumen').does.push({ es: 'Revisa tus archivos con calma.', en: 'Moves your files to another folder.' })
      )
    ).toMatch(/promises an action/)
    // Pero sí puede decir que NO lo hace.
    expect(
      errorsWith((c) =>
        first(c, 'descargas-resumen').doesNot.push({ es: 'No borra ni envía nada.', en: 'It does not delete or send anything.' })
      )
    ).toBe('')
  })

  it('la web solo se promete en Chat y debe declararse', () => {
    expect(errorsWith((c) => (first(c, 'descargas-resumen').usesWeb = true))).toMatch(/solo está respaldado en Chat/)
    expect(errorsWith((c) => (first(c, 'noticias-diarias').usesWeb = false))).toMatch(/menciona la web/)
  })

  it('una receta con carpeta no puede traer permisos de escritura ni «preguntar y esperar»', () => {
    for (const bad of [
      { permission: 'edit', pattern: '*' },
      { permission: 'bash', pattern: 'rm *' },
      { permission: 'bash', pattern: 'mv *' },
      { permission: 'bash', pattern: 'git push*' },
      { permission: 'bash', pattern: '*' },
      { permission: '*', pattern: '*' },
      { permission: 'webfetch', pattern: '*' },
      { permission: 'read', pattern: '/etc/*' }
    ]) {
      expect(
        errorsWith((c) => first(c, 'descargas-resumen').allow.push(bad)),
        JSON.stringify(bad)
      ).toMatch(/allow\[/)
    }
    expect(errorsWith((c) => (first(c, 'descargas-resumen').onAsk = 'wait'))).toMatch(/onAsk/)
    expect(errorsWith((c) => first(c, 'noticias-diarias').allow.push({ permission: 'read', pattern: '*' }))).toMatch(
      /solo las recetas con carpeta/
    )
    expect(errorsWith((c) => first(c, 'repo-estado').allow.push({ permission: 'read', pattern: '*' }))).toMatch(
      /solo las recetas con carpeta/
    )
  })

  it('exige el acceso que corresponde a cada modo y una sola pregunta de carpeta', () => {
    expect(errorsWith((c) => (first(c, 'noticias-diarias').access.level = 'read-folder'))).toMatch(/no pide acceso/)
    expect(errorsWith((c) => (first(c, 'descargas-resumen').access.level = 'none'))).toMatch(/read-folder/)
    expect(errorsWith((c) => (first(c, 'repo-estado').access.level = 'read-folder'))).toMatch(/read-project/)
    expect(errorsWith((c) => first(c, 'descargas-resumen').questions.shift())).toMatch(/exactamente una pregunta de carpeta/)
    expect(
      errorsWith((c) =>
        first(c, 'noticias-diarias').questions.push({
          id: 'carpeta',
          kind: 'folder',
          label: { es: 'Carpeta aquí', en: 'Folder here' },
          help: { es: 'Ayuda de la carpeta', en: 'Folder help text' }
        })
      )
    ).toMatch(/no lleva pregunta de carpeta/)
  })

  it('las instrucciones con carpeta deben decir que no modifican nada y dejar el resultado en la respuesta', () => {
    const r = 'descargas-resumen'
    expect(
      errorsWith(
        (c) => (first(c, r).prompt.es = first(c, r).prompt.es.replace(/No modifiques, muevas, renombres ni borres nada/, 'Haz lo que veas'))
      )
    ).toMatch(/no modifica, mueve ni borra/)
    expect(
      errorsWith(
        (c) =>
          (first(c, r).prompt.en = first(c, r).prompt.en.replace('Do not modify, move, rename or delete anything', 'Do what you see fit'))
      )
    ).toMatch(/must say it does not modify/)
    expect(errorsWith((c) => (first(c, r).prompt.es = first(c, r).prompt.es.replace('respuesta final', 'carpeta')))).toMatch(
      /respuesta final/
    )
  })

  it('las variables de la instrucción tienen pregunta, y las preguntas se usan', () => {
    expect(errorsWith((c) => (first(c, 'noticias-diarias').prompt.es += ' {{ask:otra}}'))).toMatch(/no tiene pregunta/)
    expect(errorsWith((c) => first(c, 'gastos-semana').questions.pop())).toMatch(/no tiene pregunta/)
    expect(
      errorsWith((c) => (first(c, 'gastos-semana').prompt.es = first(c, 'gastos-semana').prompt.es.replace('{{ask:foco}}', 'todo')))
    ).toMatch(/no se usa/)
    expect(errorsWith((c) => (first(c, 'noticias-diarias').prompt.es += ' {{archivos}}'))).toMatch(/variables de archivo/)
    expect(errorsWith((c) => delete first(c, 'gastos-semana').questions[2].default)).toMatch(/necesita «default»/)
  })

  it('el disparador por archivo es solo para archivos nuevos, con tope bajo y carpeta vacía', () => {
    expect(errorsWith((c) => (first(c, 'archivos-nuevos').schedule.on = 'both'))).toMatch(/archivos nuevos/)
    expect(errorsWith((c) => (first(c, 'archivos-nuevos').schedule.maxPerHour = 60))).toMatch(/maxPerHour/)
    expect(errorsWith((c) => (first(c, 'archivos-nuevos').schedule.folder = '/tmp'))).toMatch(/vacío/)
    expect(
      errorsWith(
        (c) =>
          (first(c, 'noticias-diarias').schedule = { kind: 'file', folder: '', patterns: [], on: 'create', settleSec: 5, maxPerHour: 3 })
      )
    ).toMatch(/exige una carpeta/)
    expect(errorsWith((c) => (first(c, 'noticias-diarias').schedule = { kind: 'interval', hours: 1 }))).toMatch(/no usan intervalos/)
    expect(errorsWith((c) => (first(c, 'noticias-diarias').schedule.time = '25:00'))).toMatch(/HH:MM/)
  })

  it('pide cómo se comprobó cada receta y qué no hace', () => {
    expect(errorsWith((c) => (first(c, 'noticias-diarias').verification = 'ok'))).toMatch(/verification/)
    expect(errorsWith((c) => delete first(c, 'noticias-diarias').doesNot)).toMatch(/doesNot/)
  })
})

describe('recetas de Rutinas: del formulario a la rutina', () => {
  it('rellena la instrucción con las respuestas y deja la carpeta para la persona', () => {
    const r = recipeById('gastos-semana')!
    const input = buildRecipeInput(r, 'es', { planilla: 'mis-gastos.csv', foco: 'transporte' }, model)
    expect(input.prompt).toContain('«mis-gastos.csv»')
    expect(input.prompt).toContain('transporte')
    expect(input.prompt).not.toMatch(/\{\{/)
    expect(input).toMatchObject({ mode: 'tasks', folder: null, enabled: true, onAsk: 'reject', sessionMode: 'fresh', model })
    expect(input.schedule).toEqual({ kind: 'weekly', day: 1, time: '09:00' })
  })

  it('una pregunta opcional en blanco toma su valor por omisión; las respuestas se limpian', () => {
    const r = recipeById('gastos-semana')!
    const input = buildRecipeInput(r, 'en', { planilla: '  a.csv\n', foco: '   ' }, model)
    expect(input.prompt).toContain('"a.csv"')
    expect(input.prompt).toContain('the categories with the most spending')
    expect(cleanAnswer('hola\n{{ask:x}}\tmundo', 40)).toBe('hola ask:x mundo')
    expect(cleanAnswer('x'.repeat(50), 10)).toHaveLength(10)
  })

  it('una respuesta con llaves no puede colar otra variable', () => {
    const r = recipeById('noticias-diarias')!
    const input = buildRecipeInput(r, 'es', { temas: 'cine {{archivos}} {{ask:temas}}' }, model)
    expect(input.prompt).not.toMatch(/\{\{/)
  })

  it('detecta las respuestas obligatorias que faltan y arranca con las que traen valor', () => {
    const r = recipeById('seguir-tema')!
    expect(missingAnswers(r, defaultAnswers(r, 'es')).map((q) => q.id)).toEqual(['tema'])
    expect(missingAnswers(r, { tema: '  ' }).map((q) => q.id)).toEqual(['tema'])
    expect(missingAnswers(r, { tema: 'abejas' })).toEqual([])
    const n = recipeById('noticias-diarias')!
    expect(missingAnswers(n, defaultAnswers(n, 'en'))).toEqual([])
    expect(textQuestions(n)).toHaveLength(1)
  })

  it('el resultado no comparte objetos con el catálogo (editar el formulario no cambia la receta)', () => {
    const r = recipeById('descargas-resumen')!
    const input = buildRecipeInput(r, 'es', {}, model)
    input.allow!.push({ permission: 'edit', pattern: '*' })
    ;(input.schedule as { time: string }).time = '01:00'
    expect(r.allow.some((a) => a.permission === 'edit')).toBe(false)
    expect((r.schedule as { time: string }).time).toBe('20:00')
  })

  it('el disparador por archivo conserva sus límites y deja la carpeta vacía', () => {
    const input = buildRecipeInput(recipeById('archivos-nuevos')!, 'es', {}, model)
    expect(input.schedule).toEqual({ kind: 'file', folder: '', patterns: [], on: 'create', settleSec: 10, maxPerHour: 6 })
    expect(input.prompt).toContain('{{archivos}}')
  })
})
