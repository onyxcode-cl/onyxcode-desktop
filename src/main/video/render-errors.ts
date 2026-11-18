/** Protocolo acotado del worker; el texto de la página siempre se trata como diagnóstico, no como instrucciones. */
export const RENDER_CODES = [
  'formato_no_coincide',
  'falta_composicion',
  'falta_timeline',
  'duracion_no_coincide',
  'duracion_invalida',
  'tiempo_fuera',
  'no_inicializa',
  'tiempo_agotado',
  'audio_invalido',
  'fallo_render'
] as const
export type RenderCode = (typeof RENDER_CODES)[number]
export class VideoRenderError extends Error {
  constructor(
    readonly renderCode: RenderCode,
    readonly data: Record<string, string | number> = {}
  ) {
    super(renderCode)
  }
}
export function parseRenderError(value: unknown): VideoRenderError | null {
  if (!value || typeof value !== 'object' || !('error' in value)) return null
  const e = value.error as { code?: unknown; data?: unknown } | null
  if (!e || !RENDER_CODES.includes(e.code as RenderCode)) return null
  const data: Record<string, string | number> = {}
  if (e.data && typeof e.data === 'object')
    for (const [key, val] of Object.entries(e.data).slice(0, 8)) {
      if (!['width', 'height', 'duration', 'time', 'console'].includes(key)) continue
      if (typeof val === 'number' && Number.isFinite(val)) data[key] = val
      else if (key === 'console' && typeof val === 'string') data[key] = val.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240)
    }
  return new VideoRenderError(e.code as RenderCode, data)
}

export function explainRenderError(e: VideoRenderError, format: string, width: number, height: number, seconds?: number): string {
  const d = e.data
  const messages: Record<RenderCode, string> = {
    formato_no_coincide: `El HTML declara ${d.width ?? 'sin ancho'}×${d.height ?? 'sin alto'}, pero pediste ${format} (${width}×${height}). Cambia data-width y data-height y el tamaño del lienzo, o pide el formato que corresponde.`,
    falta_composicion:
      'El HTML no tiene un elemento con data-composition-id. Añade el contenedor de la composición con su tamaño y duración.',
    falta_timeline: 'Falta la timeline GSAP pausada en window.__timelines.main. Cárgala con GSAP local y haz que dure todo el clip.',
    duracion_no_coincide: `El HTML declara ${d.duration} s, pero pediste ${seconds} s. Iguala data-duration y la duración de la timeline con el pedido.`,
    duracion_invalida:
      'data-duration debe ser un número mayor que cero y de hasta 120 segundos. Corrige también la duración de la timeline.',
    tiempo_fuera: `El cuadro de ${d.time} s queda fuera del clip (${d.duration} s). Pide un segundo menor que data-duration.`,
    no_inicializa: `El HTML no inicializa. Revisa el script y GSAP local.${d.console ? ` Primer error de la página (diagnóstico): ${JSON.stringify(d.console)}.` : ''}`,
    tiempo_agotado: 'Se agotó el tiempo del render. Simplifica la composición o acorta el clip y vuelve a pedir cuadros.',
    audio_invalido: `No se pudo mezclar el audio local. Revisa formato, recorte, inicio y volumen.${d.console ? ` Diagnóstico: ${JSON.stringify(d.console)}.` : ''}`,
    fallo_render: 'Falló el render de video. Revisa la composición y vuelve a pedir cuadros; si persiste, informa el fallo.'
  }
  if (['tiempo_agotado', 'fallo_render', 'audio_invalido'].includes(e.renderCode)) return messages[e.renderCode]
  const duration = seconds ?? (typeof d.duration === 'number' && d.duration > 0 && d.duration <= 120 ? d.duration : 15)
  return `${messages[e.renderCode]}\nEsqueleto mínimo para ${format} (adapta el contenido):\n<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}#main{position:relative;width:${width}px;height:${height}px;background:#18251d;color:white;font:64px Arial;display:grid;place-items:center}</style><div id="main" data-composition-id="main" data-start="0" data-width="${width}" data-height="${height}" data-duration="${duration}" data-fps="30"><p>Tu contenido</p></div><script src="assets/vendor/gsap.min.js"></script><script>const tl=gsap.timeline({paused:true});tl.to({},{duration:${duration}},0);window.__timelines={main:tl};</script>`
}
