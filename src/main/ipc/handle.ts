import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { IpcErrorCode, IpcEventChannel, IpcEventContract, IpcInvokeContract } from '@shared/ipc'
import type { RemoteSender } from '../remote/sender'
import { emit, emitTo } from './event-bus'
import { guardInvoke, IpcGuardError, validatePayload } from './guard'

/** Error con código IPC explícito (p.ej. NOT_READY). */
export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
  }
}

/** Resultado de una llamada: el mismo `{ ok, data }` / `{ ok:false, [code], error }` que recibe el renderer. */
export type InvokeResult = { ok: true; data: unknown } | { ok: false; code?: IpcErrorCode; error: string }

/** Despachador de un canal: valida con `validate` y ejecuta el handler (compartido por ventanas y celular). */
interface Route {
  dispatch(
    event: IpcMainInvokeEvent,
    args: unknown[],
    validate: (channel: string, args: unknown[]) => unknown,
    authorize?: RemoteCaller['authorize']
  ): Promise<InvokeResult>
  fail(code: IpcErrorCode, error: string): InvokeResult
}
const routes = new Map<string, Route>()

/**
 * Quien llama sin ser una ventana (el celular). `authorize` es el gancho de la política «celular» (T3): decide
 * por canal y payload YA validado antes de despachar; sin él (o si devuelve false) la llamada se rechaza.
 * El rol «celular» NO existe en `CHANNEL_ROLES`: ninguna ventana gana canales por esto.
 */
export interface RemoteCaller {
  sender: RemoteSender
  authorize: (channel: string, payload: unknown) => boolean | Promise<boolean>
}

/**
 * Llama a un handler registrado como lo haría el renderer: MISMO esquema (`IPC_SCHEMAS`), mismo saneado de
 * payload, mismo manejo de errores, con `event.sender` = el remitente virtual del llamador. No abre ningún
 * canal nuevo: solo despacha lo que ya registró `makeInvokeHandler`.
 */
export async function invokeAs(caller: RemoteCaller, channel: string, args: unknown[]): Promise<InvokeResult> {
  const route = routes.get(channel)
  if (!route) return { ok: false, code: 'FORBIDDEN', error: `Llamada IPC no permitida (${channel})` }
  // Evento sintético: sin frame (nunca pasa por `guardInvoke`, que exige una ventana con rol).
  const event = { sender: caller.sender, senderFrame: null } as unknown as IpcMainInvokeEvent
  // Denegar por defecto: sin política no hay llamada.
  return route.dispatch(event, args, validatePayload, caller.authorize ?? (() => false))
}

type Contract<K> = { [P in keyof K]: { req: unknown; res: unknown } }

export interface InvokeHandlerOptions {
  /** Incluye `code` en el resultado de error (los preloads de extras/browser lo desenvuelven sin él). */
  withCode: boolean
  /** Código propio para un error concreto (p.ej. `IpcError`); si devuelve undefined -> 'ERROR'. */
  errorCode?: (err: unknown) => IpcErrorCode | undefined
  /** true = no imprimir el error en consola (errores esperables). */
  silent?: (err: unknown) => boolean
}

/**
 * Crea el registrador `(ipcMain, canal, fn)` de un contrato: quita el handler previo, valida
 * emisor/payload (`guardInvoke`), envuelve el resultado en `{ ok, data }` y captura errores.
 */
export function makeInvokeHandler<K extends Contract<K>>(opts: InvokeHandlerOptions) {
  const fail = (code: IpcErrorCode, error: string) => (opts.withCode ? { ok: false as const, code, error } : { ok: false as const, error })
  return function handle<C extends keyof K & string>(
    ipcMain: IpcMain,
    channel: C,
    handler: (req: K[C]['req'], event: IpcMainInvokeEvent) => K[C]['res'] | Promise<K[C]['res']>
  ): void {
    const dispatch: Route['dispatch'] = async (event, args, validate, authorize) => {
      try {
        const req = validate(channel, args) as K[C]['req']
        // Gancho de política (solo llamadas que no son una ventana): después de validar, antes de despachar.
        if (authorize && !(await authorize(channel, req))) throw new IpcGuardError('FORBIDDEN', `Llamada IPC no permitida (${channel})`)
        return { ok: true as const, data: await handler(req, event) }
      } catch (err) {
        if (err instanceof IpcGuardError) return fail(err.kind, err.message)
        const code = opts.errorCode?.(err)
        if (code) return fail(code, (err as Error).message)
        if (!opts.silent?.(err)) console.error(`[ipc] ${channel}:`, err)
        return fail('ERROR', err instanceof Error ? err.message : String(err))
      }
    }
    routes.set(channel, { dispatch, fail })
    ipcMain.removeHandler(channel)
    // Ventanas: el emisor/rol se comprueba en `guardInvoke` (que además valida el payload con el mismo esquema).
    ipcMain.handle(channel, (event, ...args: unknown[]) => dispatch(event, args, (c, a) => guardInvoke(event, c, a)))
  }
}

/** Registra un handler tipado del contrato principal (`shared/ipc.ts`); mapea `IpcError` a su código. */
export const handle = makeInvokeHandler<IpcInvokeContract>({
  withCode: true,
  errorCode: (err) => (err instanceof IpcError ? err.code : undefined)
})

/** Envía un evento tipado a un webContents concreto. */
export function sendTo<C extends IpcEventChannel>(wc: WebContents, channel: C, payload: IpcEventContract[C]): void {
  emitTo(wc, channel, payload)
}

/** Envía un evento tipado a todas las ventanas (y a los suscriptores remotos) por el bus de eventos. */
export function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void {
  emit(channel, payload)
}
