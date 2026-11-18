/** Herramientas de video; la atadura concede la carpeta, nunca la composición ni su código. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { VideoEnsureResult } from '@shared/video'
import { LoopbackMcpServer, type McpToolResult } from '../util/loopback-mcp'
import { resolveCodeRoot, rewriteCreated, type DocumentsBinding } from '../documents/mcp-server'
import { cleanName, writeNewFile } from '../documents/output-path'
import { safeWriteFile } from '../tasks/safe-write'
import {
  audioInputs,
  checkProjectUpdate,
  photoInputs,
  textFiles,
  projectPath,
  readMedia,
  validatePhoto,
  MAX_MEDIA_TOTAL,
  MAX_TEXT_FILE,
  FONT_FAMILIES
} from './project-input'
import { downloadVideoMedia } from './web-media'
import { searchVideoMusic, type MusicSearchDeps } from './music-search'
import { copyComposition } from './composition'
import type { RenderOutput, RenderProcess } from './render-process'
import { VideoRenderError, explainRenderError } from './render-errors'

export const VIDEO_TIMEOUT_MS = 300_000
export const VIDEO_RESPONSE_TIMEOUT_MS = 960_000 // consentimiento + instalación + render
export const VIDEO_FORMATS = { vertical: [1080, 1920], cuadrado: [1080, 1080], horizontal: [1920, 1080] } as const
export interface VideoBinding extends DocumentsBinding {
  request?: (root: string, session: string, chat: boolean) => Promise<string | null>
  media?: (session: string, origin: string, kind: 'photo' | 'audio') => Promise<Buffer | null>
  chat?: { activeSession: () => Promise<string | null>; directory: string }
}
export interface VideoRenderDeps {
  privateDir: string
  pieces: () => VideoEnsureResult
  node: () => string | null
  consent: (bytes: number, signal: AbortSignal) => Promise<boolean>
  install: (signal: AbortSignal) => Promise<void>
  render: RenderProcess
  photo?: (root: string, session: string | null, chat: boolean, origin: string) => Promise<Buffer | null>
  download?: typeof downloadVideoMedia
  music?: MusicSearchDeps
  timeoutMs?: number
  pollMs?: number
}
const COMPOSITION_CONTRACT =
  'HTML obligatorio: elemento con data-composition-id="main", data-width, data-height y data-duration que coincidan con el formato (vertical 1080×1920, cuadrado 1080×1080, horizontal 1920×1080). Timeline GSAP pausada en window.__timelines.main que dure todo el clip; Escenas <template> en compositions/ y recursos en assets/. GSAP local en assets/vendor/gsap.min.js. Fuentes sin red: ' +
  FONT_FAMILIES +
  '. Corrige los avisos antes de entregar o explícalos a la persona.'
const fail = (text: string): McpToolResult => ({ isError: true, content: [{ type: 'text', text }] })

export class VideoMcpServer extends LoopbackMcpServer<VideoBinding> {
  protected readonly serverName = 'video'
  protected readonly instructions =
    'Compón un index.html con una línea de tiempo de HyperFrames y recursos locales. Primero pide cuadros, MIRA todas las imágenes, corrige y recién después pide el MP4. Declara data-width, data-height y data-duration en el elemento data-composition-id. Sin internet. En Chat envía html o archivos en cuadros; se guarda solo en esa conversación.'
  private readonly completion = new Map<VideoBinding, Promise<void>>()
  private readonly outputs = new WeakMap<VideoBinding, Map<string, { abs: string; rel: string; sha: string }>>()
  private readonly running = new Map<VideoBinding, AbortController>()
  constructor(private readonly deps: VideoRenderDeps) {
    super('video-mcp')
  }
  override async stop(): Promise<void> {
    const pending = [...this.completion.values()]
    this.closeConnections()
    await super.stop()
    await Promise.all(pending)
  }
  protected maxBodyBytes(): number {
    return 9 * 1024 * 1024
  }
  protected configTimeoutMs(): number {
    return VIDEO_RESPONSE_TIMEOUT_MS
  }
  protected onBindingGone(binding: VideoBinding): void {
    this.running.get(binding)?.abort()
  }
  protected listTools(): readonly unknown[] {
    const common = {
      composicion: {
        type: 'string',
        description: 'Ruta relativa de index.html dentro de una carpeta de composición pequeña, con sus recursos.'
      },
      formato: { type: 'string', enum: Object.keys(VIDEO_FORMATS) },
      fotos: {
        type: 'array',
        maxItems: 24,
        description:
          'Fotos de cualquier licencia: origen HTTPS público, ruta concedida, id de imagenes_usar o adjunto de Chat; destino assets/… (20 MiB web).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { origen: { type: 'string' }, destino: { type: 'string' } },
          required: ['origen', 'destino']
        }
      },
      audio: {
        type: 'array',
        maxItems: 16,
        description:
          'Audio local, adjunto o HTTPS público (mp3/m4a/aac/wav/ogg, 50 MiB web). Recorte y fundidos en segundos; volumen 0–3.98.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            origen: { type: 'string' },
            inicio: { type: 'number', minimum: 0 },
            desde: { type: 'number', minimum: 0 },
            hasta: { type: 'number', minimum: 0 },
            volumen: { type: 'number', minimum: 0, maximum: 3.98 },
            fundidoEntrada: { type: 'number', minimum: 0 },
            fundidoSalida: { type: 'number', minimum: 0 }
          },
          required: ['origen']
        }
      },
      carpeta: { type: 'string', description: 'Solo Code: ruta absoluta del proyecto abierto. En Chat y Overdrive no se pasa.' }
    }
    return [
      {
        name: 'musica_buscar',
        description:
          'Busca música en un catálogo público sin clave; devuelve título, segundos, etiquetas, licencia y origen HTTPS para audio.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { consulta: { type: 'string', maxLength: 200 }, limite: { type: 'integer', minimum: 1, maximum: 12 } },
          required: ['consulta']
        }
      },
      {
        name: 'cuadros',
        description:
          'Saca de 1 a 6 PNG a mitad de tamaño (reduce si supera el presupuesto). Míralos y corrige antes de renderizar. En Chat envía html o archivos; devuelve también hoja de contactos. ' +
          COMPOSITION_CONTRACT,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...common,
            segundos: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'number', minimum: 0, exclusiveMaximum: 120 } },
            archivos: {
              type: 'object',
              maxProperties: 64,
              additionalProperties: { type: 'string' },
              description:
                'Solo Chat: rutas relativas → texto HTML/CSS/JS/JSON/SVG. Hasta 64, 512 KiB por archivo y 4 MiB total. Con composicion actualiza solo lo enviado.'
            },
            html: {
              type: 'string',
              description: 'Solo Chat: HTML completo de la composición (hasta 512 KB). La app devuelve su ruta para el render.'
            }
          },
          required: ['formato', 'segundos']
        }
      },
      {
        name: 'render',
        description:
          'Tras mirar y corregir los cuadros, genera un MP4 H.264 a 30 fps; AAC con música HTTPS, audio local o <audio> del proyecto y tres imágenes de control. Máximo 120 s. ' +
          COMPOSITION_CONTRACT,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...common,
            duracion: { type: 'number', exclusiveMinimum: 0, maximum: 120 },
            fps: { type: 'integer', enum: [30] },
            nombre: { type: 'string', maxLength: 80 }
          },
          required: ['composicion', 'formato', 'duracion', 'fps', 'nombre']
        }
      }
    ]
  }
  protected async callTool(
    binding: VideoBinding,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpToolResult> {
    if (name === 'musica_buscar') {
      if (this.running.has(binding) || this.running.size >= 2) return fail('Hay otra operación de video en curso; espera a que termine.')
      const ac = new AbortController()
      this.running.set(binding, ac)
      let complete!: () => void
      this.completion.set(
        binding,
        new Promise<void>((done) => {
          complete = done
        })
      )
      try {
        const result = await searchVideoMusic(args, signal ? AbortSignal.any([signal, ac.signal]) : ac.signal, this.deps.music)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch {
        return fail('No se pudo buscar música. Usa consulta y limite válidos; puedes reintentar o pasar una URL HTTPS directa en audio.')
      } finally {
        this.running.delete(binding)
        this.completion.delete(binding)
        complete()
      }
    }
    if (!['cuadros', 'render'].includes(name)) return fail('Herramienta de video desconocida.')
    const permitted =
      name === 'cuadros'
        ? ['composicion', 'formato', 'carpeta', 'segundos', 'html', 'archivos', 'fotos', 'audio']
        : ['composicion', 'formato', 'carpeta', 'duracion', 'fps', 'nombre', 'fotos', 'audio']
    if (Object.keys(args).some((k) => !permitted.includes(k))) return fail('Hay argumentos de video no admitidos.')
    if (typeof args.formato !== 'string' || !Object.hasOwn(VIDEO_FORMATS, args.formato))
      return fail('Usa formato vertical, cuadrado u horizontal.')
    const seconds = name === 'render' ? args.duracion : undefined
    if (
      name === 'render' &&
      (typeof seconds !== 'number' ||
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        seconds > 120 ||
        Math.abs(seconds * 30 - Math.round(seconds * 30)) > 0.00001 ||
        args.fps !== 30 ||
        typeof args.nombre !== 'string' ||
        !args.nombre.trim() ||
        args.nombre.length > 80)
    )
      return fail('El render requiere duración de hasta 120 s (en cuadros de 1/30 s), fps 30 y nombre de salida.')
    if (name === 'render') {
      try {
        cleanName(args.nombre)
      } catch {
        return fail('Ese nombre de salida no es válido.')
      }
    }
    const times = name === 'cuadros' ? args.segundos : [1 / 6, 1 / 2, 5 / 6].map((x) => x * (seconds as number))
    if (
      !Array.isArray(times) ||
      times.length < 1 ||
      times.length > 6 ||
      times.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n >= 120)
    )
      return fail('Pide entre 1 y 6 segundos válidos (desde 0 y menores de 120).')
    if (this.running.has(binding)) return fail('Ya hay una operación de video en esta atadura; espera a que termine.')
    if (this.running.size >= 2) return fail('Ya hay dos operaciones de video en la app; vuelve a intentar al terminar una.')
    const ac = new AbortController()
    this.running.set(binding, ac)
    let complete!: () => void
    this.completion.set(
      binding,
      new Promise<void>((done) => {
        complete = done
      })
    )
    const cancel = (): void => ac.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) ac.abort()
    let timedOut = false
    const timeout = (): void => {
      timedOut = true
      cancel()
    }
    const deadline = setTimeout(timeout, VIDEO_RESPONSE_TIMEOUT_MS)
    let timer: ReturnType<typeof setInterval> | undefined
    let renderTimer: ReturnType<typeof setTimeout> | undefined
    let work: string | undefined
    try {
      ac.signal.throwIfAborted()
      let root = binding.folder
      let session = binding.session
      let chat = false
      let chatId: string | null = null
      if (binding.chat && args.carpeta === undefined) {
        const id = await binding.chat.activeSession()
        chatId = id
        if (!id) return fail('No se pudo determinar una única conversación de Chat activa.')
        await mkdir(binding.chat.directory, { recursive: true, mode: 0o700 })
        if ((await lstat(binding.chat.directory)).isSymbolicLink()) return fail('La carpeta de video no puede ser un enlace.')
        root = join(await realpath(binding.chat.directory), 'videos', createHash('sha256').update(id).digest('hex'))
        // Comprueba cada padre antes de crear la carpeta por conversación.
        const videos = join(await realpath(binding.chat.directory), 'videos')
        await mkdir(videos, { recursive: true, mode: 0o700 })
        if ((await lstat(videos)).isSymbolicLink()) return fail('La carpeta de video no puede ser un enlace.')
        await mkdir(root, { mode: 0o700, recursive: true })
        if ((await lstat(root)).isSymbolicLink()) return fail('La carpeta de video no puede ser un enlace.')
        session = async () => binding.chat!.activeSession()
        chat = true
      } else if (binding.code) {
        const found = await resolveCodeRoot(args.carpeta, binding.code.roots())
        if (!found.ok) return fail(found.message)
        root = found.root
      } else if (args.carpeta !== undefined) return fail('La carpeta la determina la app; no pases carpeta.')
      const initial = session ? await session(root) : null
      if (session && (!initial || (chatId && initial !== chatId))) return fail('La conversación o tarea ya no está activa.')
      const request = initial ? await binding.request?.(root, initial, chat).catch(() => null) : null
      let polling = false
      if (session)
        timer = setInterval(() => {
          if (polling) return
          polling = true
          void session!(root)
            .then(
              (id) => {
                if (id !== initial) ac.abort()
              },
              () => ac.abort()
            )
            .finally(() => {
              polling = false
            })
        }, this.deps.pollMs ?? 750)
      let composition = args.composicion
      const photos = photoInputs(args.fotos)
      const audio = audioInputs(args.audio)
      if (name === 'render' && audio.some((t) => t.inicio >= (seconds as number)))
        return fail('El inicio del audio debe ser menor que la duración del video.')
      const texts = args.archivos === undefined ? [] : textFiles(args.archivos)
      if (args.html !== undefined && args.archivos !== undefined) return fail('Usa html o archivos, no ambos a la vez.')
      if (args.html !== undefined) {
        if (typeof args.html !== 'string' || !args.html.trim() || Buffer.byteLength(args.html) > MAX_TEXT_FILE)
          return fail('html solo se admite en cuadros de Chat, hasta 512 KB.')
        texts.push(['index.html', args.html])
      }
      if (texts.length) {
        if (!chat || name !== 'cuadros') return fail('html y archivos solo se admiten en cuadros de Chat.')
        let base: string
        if (composition !== undefined) {
          const rel = projectPath(composition)
          if (!/^\.lazunox\/trabajo\/video\/composicion-[a-f0-9-]+\/index\.html$/.test(rel))
            throw Error('Para actualizar usa la composicion devuelta por cuadros en esta conversación.')
          base = dirname(rel)
        } else {
          if (!texts.some(([p]) => p === 'index.html')) throw Error('Un proyecto nuevo requiere index.html en archivos.')
          base = `.lazunox/trabajo/video/composicion-${randomUUID()}`
        }
        await checkProjectUpdate(
          join(root, base),
          texts.map(([path, value]) => ({ path, size: Buffer.byteLength(value) })),
          ac.signal
        )
        for (const [p, text] of texts) {
          ac.signal.throwIfAborted()
          safeWriteFile(root, join(root, base, p), Buffer.from(text), { replace: true, refuseLinkTarget: true, mode: 0o600 })
        }
        composition = `${base}/index.html`
      }
      // Recursos: ids preparados y adjuntos humanos se resuelven por main; ninguna ruta arbitraria de Chat.
      const remote = new Map<string, Awaited<ReturnType<typeof downloadVideoMedia>>>()
      const resource = async (origin: string, kind: 'photo' | 'audio'): Promise<Buffer> => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(origin) && !origin.startsWith('imagen:') && !/^[a-z]:[\\/]/i.test(origin)) {
          const downloaded = await (this.deps.download ?? downloadVideoMedia)(origin, kind, ac.signal)
          if (kind === 'photo') validatePhoto(downloaded.bytes)
          remote.set(origin, downloaded)
          return downloaded.bytes
        }
        const prepared = kind === 'photo' ? await this.deps.photo?.(root, initial, chat, origin) : null
        if (prepared) {
          validatePhoto(prepared)
          return prepared
        }
        const attached = chat && initial ? await binding.media?.(initial, origin, kind) : null
        if (attached) {
          if (kind === 'photo') validatePhoto(attached)
          return attached
        }
        return readMedia(root, origin, kind, ac.signal, !chat && binding.toAgentPath ? [binding.toAgentPath(root)] : [])
      }
      const photoBytes = []
      let mediaTotal = 0
      for (const p of photos) {
        const bytes = await resource(p.origen, 'photo')
        mediaTotal += bytes.length
        if (mediaTotal > MAX_MEDIA_TOTAL) throw Error('Los recursos superan 96 MiB en total.')
        photoBytes.push({ ...p, bytes })
      }
      const audioBytes = []
      for (const track of audio) {
        const bytes = await resource(track.origen, 'audio')
        mediaTotal += bytes.length
        if (mediaTotal > MAX_MEDIA_TOTAL) throw Error('Los recursos superan 96 MiB en total.')
        audioBytes.push({ track, bytes })
      }
      if (mediaTotal > MAX_MEDIA_TOTAL) throw Error('Los recursos superan 96 MiB en total.')
      // Fotos y audio web persisten en assets; procedencia como JSON, nunca código HTML.
      const comp = projectPath(composition)
      const updates: { path: string; bytes: Buffer }[] = photoBytes.map((p) => ({ path: p.destino, bytes: p.bytes }))
      const sources: { destino: string; origen: string; urlFinal: string; tipo: string; sha256: string }[] = []
      for (const p of photoBytes) {
        const web = remote.get(p.origen)
        if (web) {
          const extension = p.destino.split('.').at(-1)!.toLowerCase().replace('jpeg', 'jpg')
          if (extension !== web.ext) throw Error(`La foto es ${web.ext}; usa esa extensión en destino.`)
          sources.push({ destino: p.destino, ...web.provenance })
        }
      }
      for (const item of audioBytes) {
        const web = remote.get(item.track.origen)
        if (web) {
          const path = `assets/audio/web-${web.provenance.sha256}.${web.ext}`
          updates.push({ path, bytes: item.bytes })
          sources.push({ destino: path, ...web.provenance })
        }
      }
      for (const source of sources) {
        const id = createHash('sha256').update(source.destino).digest('hex')
        updates.push({ path: `assets/origenes/${id}.json`, bytes: Buffer.from(JSON.stringify(source, null, 2)) })
      }
      if (chat)
        await checkProjectUpdate(
          join(root, dirname(comp)),
          updates.map((u) => ({ path: u.path, size: u.bytes.length })),
          ac.signal
        )
      for (const u of updates) {
        ac.signal.throwIfAborted()
        safeWriteFile(root, join(root, dirname(comp), u.path), u.bytes, { replace: true, refuseLinkTarget: true, mode: 0o600 })
      }
      // Valida y copia ANTES de pedir permiso para instalar: un input inválido no solicita descargas.
      await mkdir(this.deps.privateDir, { recursive: true, mode: 0o700 })
      if ((await lstat(this.deps.privateDir)).isSymbolicLink()) throw new Error('La carpeta temporal no puede ser un enlace.')
      work = await mkdtemp(join(await realpath(this.deps.privateDir), 'render-'))
      const dest = join(work, 'input', 'composition')
      await mkdir(dest, { recursive: true, mode: 0o700 })
      const entry = await copyComposition(root, composition, dest, ac.signal)
      const renderAudio = []
      for (const [i, { track, bytes }] of audioBytes.entries()) {
        const file = join(work, `audio-${i}`)
        safeWriteFile(work, file, bytes, { mode: 0o400 })
        renderAudio.push({ ...track, file })
      }
      let pieces = this.deps.pieces()
      if (pieces.state === 'unsupported') return fail('El video no está disponible en este equipo.')
      if (pieces.state === 'missing') {
        if (!(await this.deps.consent(pieces.missingBytes, ac.signal)))
          return fail('No se instalaron las piezas de video: elegiste «Ahora no». Puedes pedirlo de nuevo cuando quieras instalarlas.')
        ac.signal.throwIfAborted()
        await this.deps.install(ac.signal)
        pieces = this.deps.pieces()
      }
      if (pieces.state !== 'ready') return fail('Faltan piezas de video; no se pudo completar la instalación.')
      const node = this.deps.node()
      if (!node) return fail('Falta el Node de la app para renderizar video.')
      ac.signal.throwIfAborted()
      const [width, height] = VIDEO_FORMATS[args.formato as keyof typeof VIDEO_FORMATS]
      renderTimer = setTimeout(timeout, this.deps.timeoutMs ?? VIDEO_TIMEOUT_MS)
      const result = await this.deps.render(
        {
          work,
          composition: entry,
          width,
          height,
          seconds: seconds as number | undefined,
          times,
          paths: pieces.paths,
          node,
          audio: renderAudio
        },
        ac.signal
      )
      ac.signal.throwIfAborted()
      if (result.images.length !== times.length || (name === 'render') !== !!result.mp4) throw new Error('El render quedó incompleto.')
      if (session && (await session(root)) !== initial) return fail('La conversación o tarea ya no está activa.')
      const finalRequest = initial ? await binding.request?.(root, initial, chat).catch(() => null) : null
      if (request && finalRequest !== request) return fail('El pedido cambió mientras se preparaba el video.')
      const output = await this.publish(
        root,
        work,
        result,
        name === 'render' ? (args.nombre as string) : 'cuadro',
        binding,
        initial && request && request === finalRequest ? JSON.stringify([initial, request]) : null,
        String(composition),
        ac.signal
      )
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              composicion: composition,
              duracion: result.duration,
              audio: result.audio,
              fuentes: sources,
              revision: result.revision,
              ...output.info,
              avisos: result.avisos ?? [],
              cobertura: result.cobertura ?? [],
              imagenesBytes: output.images.reduce((n, b) => n + 4 * Math.ceil(b.length / 3), 0)
            })
          },
          ...output.images.map((b) => ({ type: 'image' as const, data: b.toString('base64'), mimeType: 'image/png' }))
        ]
      }
    } catch (e) {
      return fail(
        ac.signal.aborted
          ? timedOut
            ? 'El video superó el tiempo máximo. Simplifica la composición o acorta el clip y vuelve a pedir cuadros.'
            : 'El video se canceló.'
          : e instanceof VideoRenderError
            ? explainRenderError(
                e,
                args.formato as string,
                VIDEO_FORMATS[args.formato as keyof typeof VIDEO_FORMATS][0],
                VIDEO_FORMATS[args.formato as keyof typeof VIDEO_FORMATS][1],
                seconds as number | undefined
              )
            : e && typeof e === 'object' && 'code' in e
              ? 'No se pudo leer o guardar la composición; revisa sus archivos y permisos.'
              : e instanceof Error
                ? e.message
                : 'No se pudo preparar el video.'
      )
    } finally {
      if (timer) clearInterval(timer)
      if (renderTimer) clearTimeout(renderTimer)
      clearTimeout(deadline)
      signal?.removeEventListener('abort', cancel)
      if (work) await rm(work, { recursive: true, force: true }).catch(() => undefined)
      this.running.delete(binding)
      this.completion.delete(binding)
      complete()
    }
  }
  private async publish(
    root: string,
    work: string,
    result: RenderOutput,
    name: string,
    binding: VideoBinding,
    request: string | null,
    composition: string,
    signal: AbortSignal
  ): Promise<{ info: Record<string, unknown>; images: Buffer[] }> {
    // El worker solo entrega estos nombres fijos dentro de SU temporal. No se siguen rutas de su JSON.
    if (
      result.images.length < 1 ||
      result.images.length > 6 ||
      result.images.some((p, i) => p !== join(work, `control-${i + 1}.png`)) ||
      (result.mp4 !== undefined && result.mp4 !== join(work, 'video.mp4')) ||
      (result.contactSheet !== undefined && result.contactSheet !== join(work, 'contactos.png'))
    )
      throw new Error('El render devolvió archivos no admitidos.')
    const paths: string[] = []
    const images: Buffer[] = []
    const path = (p: string): string => binding.toAgentPath?.(p) ?? p
    let outputs = this.outputs.get(binding)
    if (!outputs) this.outputs.set(binding, (outputs = new Map()))
    const write = async (name: string, ext: string, bytes: Buffer, maxBytes: number, subfolder?: string) => {
      const key = JSON.stringify([root, request, cleanName(name), ext, subfolder])
      const previous = request ? outputs!.get(key) : undefined
      const written =
        (previous && rewriteCreated(root, previous, bytes, maxBytes)) ||
        (await writeNewFile(root, { name, ext, bytes, maxBytes, subfolder }))
      if (outputs!.size >= 256) outputs!.delete(outputs!.keys().next().value!)
      outputs!.set(key, { ...written, sha: createHash('sha256').update(bytes).digest('hex') })
      return written
    }
    const frames = `.lazunox/trabajo/video/${createHash('sha256').update(composition).digest('hex').slice(0, 16)}`
    for (const [i, file] of result.images.entries()) {
      signal.throwIfAborted()
      const st = await lstat(file)
      if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1024 * 1024) throw new Error('El cuadro supera el límite de tamaño.')
      const bytes = await readFile(file)
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('El cuadro no es PNG.')
      const filePath = join(root, frames, `cuadro-${i + 1}.png`)
      safeWriteFile(root, filePath, bytes, { replace: true, refuseLinkTarget: true })
      paths.push(path(filePath))
      images.push(bytes)
    }
    const info: Record<string, unknown> = { cuadros: paths }
    if (result.contactSheet) {
      const st = await lstat(result.contactSheet)
      if (!st.isFile() || st.isSymbolicLink() || st.size > 1024 * 1024) throw Error('La hoja de contactos supera el límite.')
      const bytes = await readFile(result.contactSheet)
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('La hoja no es PNG.')
      const file = join(root, frames, 'contactos.png')
      safeWriteFile(root, file, bytes, { replace: true, refuseLinkTarget: true })
      info.hojaContactos = path(file)
      images.push(bytes)
    }
    if (result.mp4) {
      signal.throwIfAborted()
      const st = await lstat(result.mp4)
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.size > 256 * 1024 * 1024 ||
        !Number.isFinite(result.duration) ||
        result.duration! <= 0 ||
        result.duration! > 120.04
      )
        throw new Error('El MP4 supera los límites.')
      const bytes = await readFile(result.mp4)
      const written = await write(name, 'mp4', bytes, 256 * 1024 * 1024)
      info.ruta = path(written.abs)
      info.bytes = written.bytes
    }
    return { info, images }
  }
}
