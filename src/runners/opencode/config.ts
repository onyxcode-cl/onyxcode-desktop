import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { OpenCodeSettings } from "./types.ts";

export const DEFAULT_STEPS = 60;

/** Permisos duros: todo permitido salvo lo que saca al agente del workspace o pide interacción/red. */
export function buildPermission(): Record<string, string> {
  return {
    "*": "allow",
    external_directory: "deny",
    question: "deny",
    doom_loop: "deny",
    webfetch: "deny",
    websearch: "deny",
  };
}

/** Contenido de OPENCODE_CONFIG_CONTENT. `steps` es tope por agente (NV: nombre de clave en 1.18.x). */
export function buildConfigContent(s: OpenCodeSettings, model: string | null): string {
  const steps = s.steps ?? DEFAULT_STEPS;
  const agentName = s.agent ?? "build";
  const cfg: Record<string, unknown> = {
    permission: buildPermission(),
    autoupdate: false,
    share: "disabled",
    agent: { [agentName]: { steps } },
    ...(model ? { model } : {}),
    ...(s.configExtra ?? {}),
  };
  return JSON.stringify(cfg);
}

/** Variables que desactivan actualizaciones, descargas y telemetría de OpenCode (NV: lista exacta, ver docs/RUNNERS.md). */
export const OPENCODE_HARDENING_ENV: Record<string, string> = {
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_TERMINAL_TITLE: "1",
  OPENCODE_DISABLE_SHARE: "1",
  DO_NOT_TRACK: "1",
};

/** Escribe archivos de configuración bajo configDir, rechazando rutas que escapen. */
export function writeConfigFiles(configDir: string, files: Record<string, string>): string[] {
  const root = resolve(configDir);
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = resolve(join(root, rel));
    if (p !== root && !p.startsWith(root + sep)) throw new Error(`configFiles: ruta fuera de configDir: ${rel}`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, { mode: 0o600 });
    written.push(rel);
  }
  return written;
}

/** Entorno mínimo (whitelist) del servidor: sin heredar nada del usuario salvo PATH/LANG. */
export function buildEnv(args: {
  base: Record<string, string>;
  home: string;
  tmp: string;
  configDir: string;
  configContent: string;
  username: string;
  password: string;
  authContent: string | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "LANG", "LC_ALL", "TERM"]) {
    const v = args.base[k] ?? process.env[k];
    if (v) env[k] = v;
  }
  Object.assign(env, {
    HOME: args.home,
    XDG_CONFIG_HOME: join(args.home, ".config"),
    XDG_DATA_HOME: join(args.home, ".local", "share"),
    XDG_CACHE_HOME: join(args.home, ".cache"),
    XDG_STATE_HOME: join(args.home, ".local", "state"),
    TMPDIR: args.tmp,
    OPENCODE_CONFIG_DIR: args.configDir,
    OPENCODE_CONFIG_CONTENT: args.configContent,
    OPENCODE_SERVER_USERNAME: args.username,
    OPENCODE_SERVER_PASSWORD: args.password,
    ...OPENCODE_HARDENING_ENV,
  });
  if (args.authContent) env.OPENCODE_AUTH_CONTENT = args.authContent;
  return env;
}
