export const REPORT_SCHEMA: 1
export const SUITE_VERSION: 1
export const DISTRO: string
export const LAUNCHER: string
export const INSTALLER: string
export const REQUIRED_ATTACK_IDS: string[]
export const ISOLATION_FILES: string[]
export const FrameType: Record<'INIT' | 'OPEN' | 'DATA' | 'CLOSE' | 'ERROR' | 'WINDOW' | 'PING' | 'PONG' | 'READY' | 'EXIT', number>
export const MAX_FRAME_DATA: number
export const MAX_INIT_BYTES: number
export const FOLDER_NAMES: Record<'main' | 'rw2' | 'ro' | 'cfg' | 'victim', string>
export const LINK_NAMES: Record<'junction' | 'symDir' | 'symFile' | 'hard' | 'evil', string>
export const STUB_OPENCODE: string
export const OUTSIDE_PROBE_PY: string

export function sha256Hex(b: Uint8Array): string
export function sha256Normalized(b: Uint8Array): string
export function encodeLzpk(files: Array<{ path: string; data: Uint8Array }>): {
  buffer: Buffer
  manifest: { v: 1; files: Array<{ path: string; size: number; sha256: string; mode: number; kind: string }> }
  payloadSha: string
}
export function makeSingleFileTgz(name: string, data: Uint8Array, mode?: number): Buffer
export function buildAttackPayload(sources: { launcher: Buffer; landlock: Buffer; mux: Buffer; protocol: Buffer; suite: Buffer }): ReturnType<typeof encodeLzpk>
export function encodeFrame(id: number, type: number, data?: Buffer): Buffer
export class FrameDecoder {
  push(chunk: Buffer): Array<{ id: number; type: number; data: Buffer }>
}
export function encodePort(p: number): Buffer
export function encodeWindow(n: number): Buffer
export function toLinuxPath(win: string): string
export interface AttackLayout {
  win: Record<'base' | 'main' | 'rw2' | 'ro' | 'cfg' | 'victim' | 'scratch', string>
  linux: Record<'base' | 'main' | 'rw2' | 'ro' | 'cfg' | 'victim' | 'scratch', string>
}
export function layoutFor(root: string, run: string): AttackLayout
export function buildInit(o: { layout: AttackLayout; sandboxKey: string; serverPort: number; relayPorts: number[]; allowDelete: boolean; placeholder: string }): {
  init: Record<string, unknown>
  frame: Buffer
}
export function buildSuiteConfig(o: {
  layout: AttackLayout
  runId: string
  session: string
  token: string
  allowDelete: boolean
  prep: Record<string, unknown>
  payloadSha: string
  serverPort: number
  relayPorts: number[]
  attackTimeoutSec: number
  totalTimeoutSec: number
  only: string[]
}): Record<string, unknown>
export function parseResultLines(text: string): { results: Array<Record<string, unknown>>; done: Record<string, unknown> | null; error: string | null; bad: number }
export function parseMountinfo(text: string): Array<{ mnt: string; opts: string[]; fstype: string; source: string }>
export function outsideMountProblems(text: string): string[]
export function splitOutsideProbe(text: string): { mountinfo: string; ps: string[] } | null
export function lingeringProcesses(ps: string[]): string[]
export function newProcesses(before: unknown, after: unknown): string[]
export function assembleReport(o: {
  facts: Record<string, any>
  runs: Array<{ allowDelete?: boolean; only?: string[]; results?: unknown[]; outside?: { mountinfo?: string; ps?: string[] } | null; error?: string }>
  hashes: Record<string, string>
  pin: { version?: string } | null
}): { report: Record<string, any>; notes: string[]; blocking: string[] }
export function summarizeReport(report: Record<string, any>, notes: string[], blocking: string[]): string
