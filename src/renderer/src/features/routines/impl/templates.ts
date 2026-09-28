/** Plantillas de rutinas para el estado vacío. */
import type { RoutineInput } from '@shared/ipc-cowork'

export interface RoutineTemplate {
  id: string
  title: string
  description: string
  /** Aviso a mostrar al abrir el editor (p. ej. elegir carpeta). */
  needs?: string
  input: Omit<RoutineInput, 'model' | 'enabled'>
}

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'news',
    title: 'Resumen de noticias diario',
    description: 'Cada mañana, las noticias clave del día en viñetas con enlaces.',
    input: {
      name: 'Resumen de noticias',
      mode: 'chat',
      folder: null,
      schedule: { kind: 'daily', time: '08:00' },
      prompt:
        'Busca en la web las noticias más importantes de las últimas 24 horas sobre tecnología, economía y Chile. ' +
        'Escribe un resumen en español con 5–8 viñetas (una o dos frases cada una), agrupadas por tema, e incluye el enlace a la fuente de cada noticia. ' +
        'Termina con una línea "Para seguir de cerca" con el tema que más podría evolucionar hoy.'
    }
  },
  {
    id: 'downloads',
    title: 'Revisar Descargas y ordenar',
    description: 'Cada viernes, clasifica la carpeta Descargas en subcarpetas por tipo.',
    needs: 'Elige tu carpeta Descargas para que Cowork pueda ordenarla.',
    input: {
      name: 'Ordenar Descargas',
      mode: 'cowork',
      folder: null,
      schedule: { kind: 'weekly', day: 5, time: '17:00' },
      prompt:
        'Revisa los archivos sueltos en la raíz de esta carpeta y ordénalos en subcarpetas por tipo (Documentos, Imágenes, Instaladores, Comprimidos, Otros). ' +
        'No borres nada. Si un archivo parece un duplicado (mismo nombre con " (1)", " copia"…), muévelo a "Revisar duplicados". ' +
        'Al terminar escribe un resumen corto: cuántos archivos moviste a cada carpeta y qué dejaste para revisar.'
    }
  },
  {
    id: 'repo',
    title: 'Reporte semanal de un repo',
    description: 'Los lunes, qué cambió en el repositorio la última semana y qué está pendiente.',
    needs: 'Elige la carpeta del repositorio.',
    input: {
      name: 'Reporte semanal del repo',
      mode: 'code',
      folder: null,
      schedule: { kind: 'weekly', day: 1, time: '09:00' },
      prompt:
        'Analiza la actividad de este repositorio en los últimos 7 días usando git (git log --since="7 days ago", ramas, archivos más tocados). ' +
        'Escribe un reporte en Markdown con: 1) resumen de lo que se hizo, 2) commits destacados, 3) áreas con más cambios, ' +
        '4) TODOs/FIXMEs nuevos y 5) riesgos o cosas pendientes. No modifiques ningún archivo.'
    }
  }
]
