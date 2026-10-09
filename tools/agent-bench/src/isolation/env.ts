import { join } from "node:path";
import type { RunLayout } from "./types.ts";

export const ENV_WHITELIST = ["LANG", "LC_ALL", "TERM", "TZ", "USER", "LOGNAME", "SHELL"] as const;
export const MINIMAL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * Entorno mínimo: solo variables en lista blanca + HOME/XDG propios + PATH mínimo.
 * Nunca hereda claves ni variables arbitrarias del proceso padre.
 */
export function buildEnv(
  layout: RunLayout,
  opts: { parentEnv?: NodeJS.ProcessEnv; extraPath?: string[]; extra?: Record<string, string> } = {},
): Record<string, string> {
  const parent = opts.parentEnv ?? process.env;
  const env: Record<string, string> = {};
  for (const k of ENV_WHITELIST) {
    const v = parent[k];
    if (v !== undefined) env[k] = v;
  }
  env.HOME = layout.home;
  env.XDG_CONFIG_HOME = join(layout.home, ".config");
  env.XDG_DATA_HOME = join(layout.home, ".local", "share");
  env.XDG_CACHE_HOME = join(layout.home, ".cache");
  env.XDG_STATE_HOME = join(layout.home, ".local", "state");
  env.TMPDIR = layout.tmp;
  env.PATH = [...(opts.extraPath ?? []), MINIMAL_PATH].join(":");
  env.AB_RUN_ROOT = layout.root; // marca de run: la heredan los descendientes (barrido de huérfanos por `ps -E`)
  Object.assign(env, opts.extra ?? {});
  return env;
}
