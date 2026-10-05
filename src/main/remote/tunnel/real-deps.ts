/**
 * Dependencias reales de `CloudflaredProcess` (las que tocan Electron): registro de PIDs, lanzador sin TCC y matar árboles. Aparte
 * para que `cloudflared.ts` sea probable con dobles.
 */
import { spawn } from 'node:child_process'
import { withDisclaim } from '../../process/disclaim'
import { descendantsOf, killTree, trackPid, untrackPid } from '../../opencode/pids'
import type { CloudflaredDeps } from './cloudflared'

export const realCloudflaredDeps: CloudflaredDeps = {
  spawn,
  killTree,
  descendants: descendantsOf,
  trackPid,
  untrackPid,
  withDisclaim
}
