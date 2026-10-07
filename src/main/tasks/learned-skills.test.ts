/**
 * Skills aprobadas (decisión del dueño, 2026-10-07): vive en `<folder>/.opencode/skills/<name>/SKILL.md`.
 * A diferencia de la memoria (userData), las skills están DENTRO de la carpeta del proyecto porque así las
 * descubre OpenCode. Usa SIEMPRE una carpeta de prueba real (tmpdir), nunca toca la carpeta real del usuario.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { skillAlreadyExists, skillPathFor, writeApprovedSkill } from './learned-skills'

let testFolder: string

beforeEach(() => {
  testFolder = mkdtempSync(join(tmpdir(), 'lzx-skill-proyecto-'))
})

afterEach(() => {
  rmSync(testFolder, { recursive: true, force: true })
})

describe('writeApprovedSkill', () => {
  it('escribe una skill válida en <folder>/.opencode/skills/<name>/SKILL.md', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'mi-skill',
      description: 'Una skill de prueba',
      body: 'Este es el cuerpo de la skill'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // `join` usa `\` en Windows: se compara contra la ruta esperada armada igual, no contra un string con `/` fijo.
      expect(result.path).toBe(join(testFolder, '.opencode', 'skills', 'mi-skill', 'SKILL.md'))
      const content = readFileSync(result.path, 'utf8')
      expect(content).toContain('name: mi-skill')
      expect(content).toContain('description: "Una skill de prueba"')
      expect(content).toContain('Este es el cuerpo de la skill')
    }
  })

  it('el archivo tiene frontmatter YAML válido con name y description', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test-skill',
      description: 'Descripción de prueba',
      body: 'Contenido'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const content = readFileSync(result.path, 'utf8')
      expect(content).toMatch(/^---\nname: test-skill\ndescription: ".*"\n---\n\n/)
    }
  })

  it('name con mayúsculas: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'Mi-Skill',
      description: 'Desc',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nombre-invalido')
    // Verifica que no se creó nada en .opencode/skills (la carpeta no debe existir)
    const opencodePath = join(testFolder, '.opencode')
    const skillsPath = join(opencodePath, 'skills')
    if (existsSync(opencodePath)) {
      if (existsSync(skillsPath)) {
        expect(readdirSync(skillsPath, { recursive: true })).toHaveLength(0)
      }
    }
  })

  it('name con /: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'mal/nombre',
      description: 'Desc',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nombre-invalido')
  })

  it('name con ..: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: '..exploit',
      description: 'Desc',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nombre-invalido')
  })

  it('name con espacios: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'mal nombre',
      description: 'Desc',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nombre-invalido')
  })

  it('name vacío: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: '',
      description: 'Desc',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nombre-invalido')
  })

  it('name de más de 64 caracteres: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'a'.repeat(65),
      description: 'Desc',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nombre-invalido')
  })

  it('description vacía: rechaza con campo-faltante', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: '',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('campo-faltante')
  })

  it('body vacío: rechaza con campo-faltante', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'Desc',
      body: ''
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('campo-faltante')
  })

  it('description de más de 1024 caracteres: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'a'.repeat(1025),
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('demasiado-largo')
  })

  it('body de más de 20000 caracteres: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'Desc',
      body: 'a'.repeat(20001)
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('demasiado-largo')
  })

  it('body con más de 500 líneas: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'Desc',
      body: Array(501).fill('linea').join('\n')
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('demasiado-largo')
  })

  it('description con secreto (sk-ant-...): rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'Mi clave es sk-ant-abcdefgh12345678',
      body: 'Body'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('secreto')
  })

  it('body con secreto: rechaza', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'Desc',
      body: 'api_key: sk-ant-secret123456789'
    }) as { ok: false; reason: string }

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('secreto')
  })

  it('escribir dos veces la MISMA skill: la segunda rechaza con ya-existe', () => {
    const skill = {
      name: 'duplicada',
      description: 'Primera',
      body: 'Contenido 1'
    }

    const first = writeApprovedSkill(testFolder, skill)
    expect(first.ok).toBe(true)

    const skill2 = {
      name: 'duplicada',
      description: 'Segunda',
      body: 'Contenido 2'
    }
    const second = writeApprovedSkill(testFolder, skill2) as { ok: false; reason: string }

    expect(second.ok).toBe(false)
    expect(second.reason).toBe('ya-existe')

    // El archivo original NO se pisó
    if (first.ok) {
      const content = readFileSync(first.path, 'utf8')
      expect(content).toContain('Primera')
      expect(content).toContain('Contenido 1')
      expect(content).not.toContain('Segunda')
    }
  })

  it('dos carpetas distintas pueden tener una skill con el MISMO nombre', () => {
    const folderB = mkdtempSync(join(tmpdir(), 'lzx-skill-proyecto-'))

    const skill = {
      name: 'compartido',
      description: 'En A',
      body: 'Contenido A'
    }

    const resA = writeApprovedSkill(testFolder, skill)
    const resB = writeApprovedSkill(folderB, skill)

    expect(resA.ok).toBe(true)
    expect(resB.ok).toBe(true)

    if (resA.ok && resB.ok) {
      expect(resA.path).not.toBe(resB.path)
      expect(readFileSync(resA.path, 'utf8')).toContain('En A')
      expect(readFileSync(resB.path, 'utf8')).toContain('En A')
    }

    rmSync(folderB, { recursive: true, force: true })
  })
})

describe('skillAlreadyExists', () => {
  it('retorna false antes de escribir', () => {
    expect(skillAlreadyExists(testFolder, 'no-existe')).toBe(false)
  })

  it('retorna true después de escribir', () => {
    writeApprovedSkill(testFolder, {
      name: 'existe',
      description: 'Desc',
      body: 'Body'
    })
    expect(skillAlreadyExists(testFolder, 'existe')).toBe(true)
  })

  it('retorna false con un nombre inválido', () => {
    expect(skillAlreadyExists(testFolder, 'Nombre/Invalido')).toBe(false)
  })
})

describe('skillPathFor', () => {
  it('devuelve la ruta esperada con un nombre válido', () => {
    const path = skillPathFor(testFolder, 'mi-skill')
    expect(path).toBe(join(testFolder, '.opencode', 'skills', 'mi-skill', 'SKILL.md'))
  })

  it('devuelve null con un nombre inválido', () => {
    expect(skillPathFor(testFolder, 'Nombre/Invalido')).toBeNull()
    expect(skillPathFor(testFolder, '')).toBeNull()
    expect(skillPathFor(testFolder, 'a'.repeat(65))).toBeNull()
  })
})

describe('escritura atómica', () => {
  it('crea la carpeta .opencode/skills si no existe', () => {
    writeApprovedSkill(testFolder, {
      name: 'test',
      description: 'Desc',
      body: 'Body'
    })
    const skillsDir = join(testFolder, '.opencode', 'skills')
    const files = readdirSync(skillsDir, { recursive: true })
    expect(files.length).toBeGreaterThan(0)
  })

  it('la escritura es atómica: el archivo final es completo (no queda .tmp)', () => {
    const result = writeApprovedSkill(testFolder, {
      name: 'atomica',
      description: 'Test',
      body: 'Contenido'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const skillsDir = join(testFolder, '.opencode', 'skills')
      const files = readdirSync(skillsDir, { recursive: true })
      // Con recursive: true, los nombres son rutas relativas (e.g., 'atomica/SKILL.md')
      const fileStr = files.join('|')
      expect(fileStr).not.toContain('SKILL.md.tmp')
      expect(fileStr).toContain('SKILL.md')
    }
  })
})
