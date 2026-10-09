import { parseArgs, UsageError } from "./args.ts";
import { COMMANDS, DataError } from "./commands.ts";
import { EXIT, makeCtx, type CmdResult, type Ctx } from "./ctx.ts";

export function helpText(): string {
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  return [
    "agent-bench: banco de pruebas para agentes de coding",
    "",
    "Uso: agent-bench <comando> [opciones]   (agent-bench <comando> --help para el detalle)",
    "",
    ...Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(w + 2)}${c.summary}`),
    "",
    "Opciones comunes: --json --dry-run --max-cost USD --max-concurrency 1|2 --max-runs N --max-wall SEG --timeout SEG --seed N --out DIR",
    "Códigos de salida: 0 ok, 1 fallo, 2 uso incorrecto, 3 rechazado por seguridad, 4 datos no encontrados/inválidos, 5 módulo no disponible, 130 interrumpido",
    "",
  ].join("\n");
}

/** Ejecuta el CLI y devuelve el código de salida (no llama a process.exit). */
export async function main(argv: readonly string[], ctx: Ctx): Promise<number> {
  const [cmd, ...rest] = argv;
  const json = argv.includes("--json");
  const emit = (r: CmdResult): number => {
    if (json) ctx.stdout(JSON.stringify({ schemaVersion: "1", command: cmd ?? null, ok: r.code === EXIT.OK, exitCode: r.code, ...r.data }, null, 2) + "\n");
    else if (r.code === EXIT.OK || r.code === EXIT.FALLO) ctx.stdout(r.text + "\n");
    else ctx.stderr(r.text + "\n");
    return r.code;
  };
  const err = (code: number, message: string): number => {
    if (json) ctx.stdout(JSON.stringify({ schemaVersion: "1", command: cmd ?? null, ok: false, exitCode: code, error: message }) + "\n");
    else ctx.stderr(`Error: ${message}\n`);
    return code;
  };
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
    ctx.stdout(helpText());
    return EXIT.OK;
  }
  const def = COMMANDS[cmd];
  if (!def) {
    if (!json) ctx.stderr(`Error: comando desconocido "${cmd}"\n\n${helpText()}`);
    return json ? err(EXIT.USO, `comando desconocido "${cmd}"`) : EXIT.USO;
  }
  try {
    const parsed = parseArgs(rest, def.opts);
    if (parsed.options["help"] === true) {
      ctx.stdout(`${def.summary}\n\nUso: ${def.usage}\n`);
      return EXIT.OK;
    }
    const r = await def.run(parsed, ctx);
    const code = emit(r);
    return ctx.signal.aborted && code === EXIT.OK ? EXIT.INTERRUMPIDO : code;
  } catch (e) {
    if (e instanceof UsageError) return err(EXIT.USO, `${e.message}. Ver: agent-bench ${cmd} --help`);
    if (e instanceof DataError) return err(EXIT.DATOS, e.message);
    return err(EXIT.FALLO, `fallo inesperado: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Punto de entrada real: engancha SIGINT/SIGTERM y sale con el código. */
export async function runCli(argv: readonly string[]): Promise<void> {
  const ac = new AbortController();
  const onSig = (): void => {
    if (ac.signal.aborted) return;
    process.stderr.write("\nInterrupción recibida: apagando de forma ordenada...\n");
    ac.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  const code = await main(argv, makeCtx(ac.signal));
  process.exitCode = code;
}
