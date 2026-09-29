/** Plantillas de rutinas para el estado vacío. */
import type { RoutineInput } from '@shared/ipc-tasks'

export interface RoutineTemplate {
  id: string
  title: string
  description: string
  /** Aviso a mostrar al abrir el editor (p. ej. elegir carpeta). */
  needs?: string
  input: Omit<RoutineInput, 'model' | 'enabled'>
}

/**
 * Patrón de las plantillas desatendidas: primero revisa y resume, luego propone, y solo al final
 * actúa (únicamente en lo seguro y reversible). Nadie puede responder preguntas durante la
 * ejecución, así que las propuestas quedan escritas en un archivo para revisarlas después.
 */
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
    description: 'Cada viernes, revisa Descargas, propone un orden y mueve solo lo evidente.',
    needs: 'Elige tu carpeta Descargas para que la tarea pueda ordenarla.',
    input: {
      name: 'Ordenar Descargas',
      mode: 'tasks',
      folder: null,
      schedule: { kind: 'weekly', day: 5, time: '17:00' },
      sessionMode: 'fresh',
      onAsk: 'reject',
      allow: [
        { permission: 'bash', pattern: 'ls*' },
        { permission: 'bash', pattern: 'mkdir *' }
      ],
      prompt:
        'Trabaja en tres pasos, en este orden.\n' +
        '1) REVISA Y RESUME: lista los archivos sueltos en la raíz de esta carpeta y resume qué hay (tipos, tamaños, duplicados probables con " (1)" o " copia").\n' +
        '2) PROPÓN: escribe en "propuesta-orden.md" cómo ordenarlos en subcarpetas por tipo (Documentos, Imágenes, Instaladores, Comprimidos, Otros) y qué dejarías para revisar.\n' +
        '3) ACTÚA: mueve solo lo evidente y reversible a esas subcarpetas. No borres nada; los posibles duplicados van a "Revisar duplicados". Si un paso pide un permiso que no tienes, sáltalo y anótalo en la propuesta.\n' +
        'Termina con un resumen corto: cuántos archivos moviste a cada carpeta y qué quedó pendiente de tu revisión.'
    }
  },
  {
    id: 'inbox',
    title: 'Documentos nuevos: resumen y propuesta',
    description: 'Cada día laboral, resume lo nuevo de una carpeta y propone qué hacer con ello.',
    needs: 'Elige la carpeta donde llegan los documentos. Cada ejecución continúa la misma tarea, así recuerda lo que ya vio.',
    input: {
      name: 'Documentos nuevos',
      mode: 'tasks',
      folder: null,
      schedule: { kind: 'cron', expr: '0 9 * * 1-5' },
      sessionMode: 'continue',
      onAsk: 'wait',
      allow: [],
      prompt:
        'Trabaja en tres pasos, en este orden.\n' +
        '1) REVISA Y RESUME: busca archivos nuevos o modificados desde tu última revisión (si es la primera vez, los de los últimos 7 días) y resume cada uno en una o dos frases.\n' +
        '2) PROPÓN: para cada uno, sugiere la siguiente acción (archivar, responder, actualizar un informe, pedir datos) y guárdalo en "propuestas.md" con la fecha de hoy.\n' +
        '3) ACTÚA: no modifiques ni muevas los documentos originales. Solo actualiza "propuestas.md".\n' +
        'Termina con un resumen de tres líneas como máximo: cuántos documentos nuevos había y cuál es lo más urgente.'
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
        'Trabaja en tres pasos, en este orden. ' +
        '1) REVISA Y RESUME: analiza la actividad de este repositorio en los últimos 7 días con git (git log --since="7 days ago", ramas, archivos más tocados). ' +
        '2) PROPÓN: identifica riesgos, TODOs/FIXMEs nuevos y próximos pasos razonables. ' +
        '3) ACTÚA: escribe el reporte en Markdown con resumen, commits destacados, áreas con más cambios, TODOs/FIXMEs nuevos y riesgos o pendientes. ' +
        'No modifiques ningún archivo del proyecto ni ejecutes comandos que cambien el repositorio.'
    }
  }
]
