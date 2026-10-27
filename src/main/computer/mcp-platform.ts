/**
 * Contrato de «backend de plataforma» del MCP de Control del PC (plan C, tanda C3).
 *
 * El MCP (`mcp-server.ts`) es independiente de la plataforma: transporte HTTP, kill-switch, plan, concesiones por app y
 * herramientas. Lo que SÍ depende del sistema vive detrás de esta interfaz, con dos implementaciones:
 *   - `mcp-platform-darwin.ts`: lo de siempre (helper Swift `cu-helper`, `screencapture`/ScreenCaptureKit, `sips`, Spotlight).
 *     Comportamiento y salidas BYTE A BYTE iguales (`mcp-server.equivalence.test.ts`).
 *   - `mcp-platform-win32.ts`: `cu-helper.exe` por el MISMO protocolo de línea de comandos + JSON (`resources/computer-use/protocol.json`).
 *
 * Este archivo solo define tipos: NO importa `electron` ni módulos de la app (el MCP se empaqueta como entrada aparte,
 * `out/main/computer-mcp.js`, y un import compartido crearía un chunk que el utilityProcess no espera). Cualquier módulo que
 * importe el MCP debe usarse SOLO desde el MCP.
 */

export type AppTier = 'view' | 'click' | 'full'

/**
 * Una app. `bundleId` es la CLAVE de la app: el bundle id en macOS y el `appKey` en Windows (`exe:<ruta>|pub:<editor>` o
 * `aumid:<id>`, ver `policy/app-key.ts`). El nombre del campo se mantiene porque es el del canal lateral con main
 * (`/tier?bundleId=`, `request-access`) y el de `computer-grants.json`.
 */
export interface AppRef {
  bundleId: string
  name: string
}

export interface Screen {
  width: number
  height: number
  scale: number
  main?: boolean
  /** Origen (arriba-izquierda), relativo a la pantalla principal — puede ser negativo (un monitor a
   * la izquierda/arriba de la principal). Ausente/0 en Windows: no distingue monitores todavía. */
  x?: number
  y?: number
  /** macOS únicamente (id de `CGDirectDisplayID`/ScreenCaptureKit) — para `screenshot-sck` cuando hay
   * que capturar una pantalla que no es la principal (F8-B150). */
  displayID?: number
}

/** Configuración del proceso del MCP que necesitan los backends (leída de las variables de entorno). */
export interface PlatformConfig {
  /** `CU_HELPER`: ruta al binario nativo. */
  helper: string
  eventsUrl: string
  /** `COMPUTER_INSTANT=1`. */
  instant: boolean
  /** `COMPUTER_TYPE_DELAY_MS` (cadena tal cual; vacía = el del helper). */
  typeDelay: string
  /** Lado largo máximo de la captura (`COMPUTER_MAX_LONG_SIDE`). */
  maxLong: number
  shotDir: string
  /** `COMPUTER_FAKE_SCREENSHOT` (solo pruebas): imagen en lugar de capturar. */
  fakeShot: string
  /** Apps que NUNCA se excluyen de la captura (macOS; ver `NEVER_EXCLUDE` en `mcp-server.ts`). */
  neverExclude: ReadonlySet<string>
  /** Origen aislado (puente de apps): subconjunto de `neverExclude` que SÍ se tapa en sus capturas (la propia Lazunox, Spotlight…). */
  isolatedMask?: ReadonlySet<string>
}

/** Lo que el MCP pone a disposición del backend (consultas al canal lateral, pantalla principal, registro). */
export interface PlatformHost {
  config: PlatformConfig
  log: (...a: unknown[]) => void
  /** Nivel concedido a una app (`null` = sin concesión); lanza si main no responde. */
  tierOf: (app: AppRef, session?: string) => Promise<AppTier | null>
  /** Pantalla principal normalizada por el backend (cacheada). */
  mainScreen: () => Promise<Screen>
  /** GET JSON al canal lateral (`<COMPUTER_EVENTS_URL><path>`); lanza si no hay canal o no responde (falla cerrado). */
  sideGet: (path: string) => Promise<unknown>
}

export interface CaptureRequest {
  /** PNG intermedio (macOS). */
  raw: string
  /** JPEG final que debe quedar escrito. */
  out: string
  session?: string
  /** Petición de origen aislado (puente de apps): se tapan también las apps exentas de `PlatformConfig.isolatedMask`. */
  isolated?: boolean
  /**
   * Pantalla a capturar (F8-B150) — la que tiene la ventana de la app en primer plano, calculada en
   * `mcp-server.ts` (`screenForCapture`), NO siempre la principal. Si se omite (o es la principal),
   * el comportamiento es idéntico a como era antes de esto. macOS únicamente por ahora: Windows la
   * ignora (su "escritorio virtual" ya es un espacio único, ver `normalizeScreen` de ese backend).
   */
  screen?: Screen
}

/** Qué clase de herramienta se va a ejecutar (para las comprobaciones previas de Windows). */
export interface PreflightInfo {
  tool: string
  /** Usa el ratón o el teclado REALES (no UI Automation ni captura). */
  realInput: boolean
}

export interface WindowShotResult {
  width: number
  height: number
  title?: string
}

/** Resultado de un comando del helper con su código de salida (0 = correcto). */
export interface HelperResult {
  stdout: string
  code: number
}

export interface PlatformBackend {
  readonly id: 'darwin' | 'win32'

  // ── helper nativo ──
  /** Ejecuta `cu-helper <banderas globales> <args>`; lanza con el mensaje de stderr si sale con error. */
  helper: (...args: string[]) => Promise<string>
  /** Como `helper`, pero devuelve el código de salida (≠0 no lanza, salvo fallo de arranque o tiempo agotado). */
  helperExit: (...args: string[]) => Promise<HelperResult>
  /**
   * Teclado por teclas FÍSICAS para clientes de escritorio remoto (`cu-keys`, solo macOS): escribe `text` o pulsa
   * combinaciones con modificadores reales, en un único proceso. `layout: 'us'` fuerza la tabla de teclado inglés de EE. UU.
   * (para un equipo remoto con esa distribución). Ausente en plataformas sin esa herramienta.
   */
  typeKeys?: (text: string, layout?: 'mac' | 'us') => Promise<string>
  pressKeys?: (combos: string, layout?: 'mac' | 'us') => Promise<string>
  /**
   * Portapapeles de TEXTO del Mac (solo macOS): `pasteText` lo sustituye por `text`, pulsa `combo` (p. ej. `cmd+v`) y lo restaura.
   * Es el camino que NO depende de la distribución de teclado del equipo remoto (Windows App, AnyDesk… sincronizan el portapapeles).
   */
  pasteText?: (text: string, combo: string) => Promise<{ restored: boolean }>
  /** Mensaje legible para el modelo de un código de salida del helper (`null` = sin mensaje propio). */
  exitMessage: (code: number) => string | null
  /** Detiene los helpers en vuelo (Detener a mitad de una acción). */
  killChildren: () => void
  /** Cierre ordenado del MCP: lo que haya que hacer tras `killChildren` (Windows: `release-input`). */
  shutdown: () => Promise<void>

  // ── puertas propias de la plataforma ──
  /** Antes de CADA herramienta (tras el kill-switch y antes del plan): consentimiento, sesión interactiva, elevación. */
  preflight: (info: PreflightInfo) => Promise<void>
  /** Política de combinaciones de teclas. Devuelve las teclas a enviar o lanza con el motivo. */
  checkKeys: (keys: string) => Promise<string>
  /** `true` = si no se puede identificar la app en primer plano / bajo el punto, se rechaza la acción (macOS: no bloquea). */
  readonly failClosedOnUnknownApp: boolean
  /** Interpreta la salida JSON de `frontmost`, `app-at` y `resolve-app` (la clave puede venir como `bundleId` o `appKey`). */
  parseApp: (json: unknown) => AppRef

  // ── pantalla y capturas ──
  normalizeScreen: (raw: Screen & Record<string, unknown>) => Screen
  /** Captura la pantalla principal y deja el JPEG en `req.out`; devuelve su tamaño en píxeles. Falla cerrado en Windows. */
  captureScreen: (req: CaptureRequest) => Promise<{ width: number; height: number }>
  /** Captura de la ventana de una app a JPEG en `out` (`raw` es el intermedio de macOS). */
  windowShot: (appKey: string, raw: string, out: string, windowIndex: number) => Promise<WindowShotResult>
  /**
   * Recorta `inPath` (una captura de pantalla completa ya tomada) a la región dada y la agranda
   * `scale` veces, dejando el resultado (JPEG) en `outPath`. Windows: todavía no implementado — lanza
   * con un mensaje claro en vez de intentar un comando nativo que no existe ahí (F8-B149).
   */
  zoomImage: (req: { inPath: string; outPath: string; x: number; y: number; width: number; height: number; scale: number }) => Promise<{
    width: number
    height: number
  }>

  /**
   * AGREGA `text` al final del valor de accesibilidad de `ref` (AXSelectedTextRange + AXSelectedText),
   * sin reemplazar lo que ya había (a diferencia de `ax-set-value`) — pensado para no perder contenido
   * rico (adjuntos, formato) al escribir en un campo. Windows: todavía no implementado — lanza con un
   * mensaje claro en vez de un comando nativo que no existe ahí (F8-B151).
   */
  insertAxText: (bundleId: string, ref: string, text: string) => Promise<void>

  // ── apps ──
  resolveApp: (name: string) => Promise<AppRef & { found: boolean }>
  /**
   * Claves de las apps que YA están abiertas con ventanas de la persona (para avisar de que no se escriba sobre su trabajo).
   * Excluye a Lazunox y al shell. Falla blando: sin la lista el MCP simplemente no avisa.
   */
  openAppKeys?: () => Promise<Set<string>>

  // ── textos para el modelo (los de macOS son los de siempre) ──
  text: {
    instructions: string
    /** Reemplazos de descripción de herramientas en `tools/list` (por nombre). */
    toolDescriptions: Record<string, string>
    /** Mensaje cuando `request_access`/`app_*` no encuentran la app. */
    appNotFound: (name: string) => string
    noAppsFound: (missing: string[]) => string
  }
}
