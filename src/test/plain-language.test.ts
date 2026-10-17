import { describe, expect, it } from 'vitest'
import { es } from '../shared/i18n/es'
import { en } from '../shared/i18n/en'

/**
 * Guardia de lenguaje llano (textos visibles). Un solo nombre por concepto en Chat, Code, Overdrive, Rutinas y Ajustes:
 *   clave de acceso (no «API key» suelto) · servicio de IA (no «proveedor») · conectores (no «servidor MCP») ·
 *   archivos creados (no «entregables») · aprobación automática (no «Modo auto»).
 * El término técnico solo puede ir entre paréntesis o en un texto de ayuda ("(API key)", "(MCP)", "protocolo MCP").
 */
function entries(dict: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v === 'string') out.push([k, v])
    else if (v && typeof v === 'object')
      for (const s of Object.values(v as Record<string, unknown>)) if (typeof s === 'string') out.push([k, s])
  }
  return out
}

const ES = entries(es as unknown as Record<string, unknown>)
const EN = entries(en as unknown as Record<string, unknown>)

function offenders(list: Array<[string, string]>, re: RegExp, allow?: RegExp): string[] {
  return list.filter(([, v]) => re.test(allow ? v.replace(allow, '') : v)).map(([k]) => k)
}

describe('lenguaje llano en la interfaz', () => {
  it('es: sin «Modo auto», «Entregables» ni «proveedor» como nombre de concepto', () => {
    expect(offenders(ES, /Modo auto\b/i)).toEqual([])
    expect(offenders(ES, /entregable/i)).toEqual([])
    expect(offenders(ES, /proveedor/i)).toEqual([])
  })

  it('es: «API key» y «MCP» solo entre paréntesis o como ayuda', () => {
    expect(offenders(ES, /API key/, /\(API key\)/g)).toEqual([])
    expect(offenders(ES, /\bMCP\b/, /\(MCP\)|protocolo MCP/g)).toEqual([])
  })

  it('es: «servidor MCP» y «cron» suelto no son etiquetas', () => {
    expect(offenders(ES, /servidores? MCP/i)).toEqual([])
    expect(offenders(ES, /Cron avanzado/)).toEqual([])
  })

  it('en: el mismo vocabulario (access key, AI service, connectors, files created, automatic approval)', () => {
    expect(offenders(EN, /Auto mode/i)).toEqual([])
    expect(offenders(EN, /deliverable/i)).toEqual([])
    expect(offenders(EN, /MCP server/i)).toEqual([])
    expect(offenders(EN, /API key/, /\(API key\)/g)).toEqual([])
    expect(offenders(EN, /\bprovider\b/i, /\{provider\}|model provider host/gi)).toEqual([])
  })

  it('el aviso de modelo incompatible en Overdrive cabe en una línea y su detalle va aparte', () => {
    const short = (es as unknown as Record<string, string>)['tasks.sandboxProviderShort']
    expect(short.length).toBeLessThanOrEqual(70)
    expect((en as unknown as Record<string, string>)['tasks.sandboxProviderShort'].length).toBeLessThanOrEqual(70)
    expect((es as unknown as Record<string, string>)['tasks.sandboxProviderMore']).toBe('Ver detalle')
  })

  it('los estados vacíos de la barra lateral son de su modo (Chat no manda a abrir carpetas)', () => {
    const d = es as unknown as Record<string, string>
    expect(d['app.sidebar.emptyHint.chat']).not.toMatch(/carpeta|\+/)
    expect(d['app.sidebar.emptyHint.tasks']).not.toMatch(/Abre una carpeta/)
    expect(d['app.sidebar.emptyHint.code']).toMatch(/carpeta/)
  })
})
