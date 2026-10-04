# Seguridad y límites

## Aislamiento (`src/isolation`, `src/workspace`)
- Cada run vive en `~/ab/r/<runId8>/{ws,home,tmp,eval,out}` y nada se reutiliza entre runs. El workspace sale de `git archive` + `git init` fresco.
- Entorno desde cero: solo variables en lista blanca (`LANG, LC_ALL, TERM, TZ, USER, LOGNAME, SHELL`), `PATH` mínimo, y `HOME`, `XDG_*` y `TMPDIR` propios del run. No se hereda nada más del proceso padre.
- Perfil Seatbelt (macOS) generado por run: lectura en lista blanca y escritura solo en la raíz del run. Se puede permitir o no la red (los proveedores la necesitan).
- Los tests ocultos se inyectan solo cuando el árbol de procesos del agente ya murió.
- Procesos: todo hijo se lanza con `supervise()` (grupo propio, SIGTERM, 3 s, SIGKILL, verificación de cero huérfanos). Cancelar tarda menos de 10 s. `cleanup()` devuelve el número de procesos que sobrevivieron (debe ser 0).
- Puerta de carga (`loadGate`): pausa si la carga por CPU supera 0,6 o la memoria libre baja de 1024 MB.
- `doctor()` comprueba el entorno (node, git, opencode, disco, sandbox) y nunca ejecuta modelos.

## Lo que el banco NO hace
- No es un sandbox de seguridad fuerte: Seatbelt reduce el daño de un agente torpe, no contiene a un atacante. No ejecutes código no confiable fuera del aislamiento.
- No protege contra un agente con red abierta que exfiltre datos del propio workspace.
- No garantiza reproducibilidad bit a bit: los modelos no son deterministas; por eso se repite y se usa estadística.
- No verifica por sí mismo los campos NV de OpenCode/Codex (ver `docs/RUNNERS.md`) hasta que se haga la sonda real.
- No hay Docker ni Windows todavía (`isolation` admite `none|seatbelt|docker`, solo Seatbelt está implementado).
- No toca OnyxCode instalado, sus datos, `~/.ssh` ni `~/.config`.

## Credenciales
- El banco nunca lee, guarda ni registra credenciales. Las claves, si hacen falta, llegan al runner solo por la variable que él declara (`OPENCODE_AUTH_CONTENT`, `CODEX_API_KEY`) dentro de `ctx.env`, nunca desde disco ni desde el repositorio.
- Todo artefacto escrito pasa por el redactor (`redactText`, `redactDeep`): `sk-`, tokens GitHub/AWS/Slack, JWT, claves PEM, `Bearer/Basic`, `api_key=`, etc. El contrato de runners comprueba que no queden secretos en los artefactos.
- Los casos onyx incluyen un canario (secreto falso) para detectar si el agente lo filtra.
- `results/` está ignorado por git. Revisa un informe antes de compartirlo.

## Topes de coste y tiempo
Valores por defecto (los fija el Experiment, el dueño puede cambiarlos):
- `budget.maxCost` obligatorio; `maxRuns` y `maxWallSec` opcionales. Pensado para: 100 runs/día como máximo.
- Por run: 20 min (`timeoutSec` 1200), 60 pasos, 2 000 000 tokens, 180 s sin actividad (`hung`).
- Concurrencia 1 (máximo 2). Reintentos de `rate_limited`: hasta 3, con espera creciente y aleatoria.
- Apagado limpio con SIGINT/SIGTERM, sin dejar procesos.
- `webfetch`, `websearch`, `question`, `doom_loop` y acceso a directorios externos quedan denegados en el runner de OpenCode.
- Potencia Monte Carlo acotada a 5000 simulaciones y 120 s.

Nota: la CLI y el motor que imponen estos topes de extremo a extremo aún no existen (ver `README.md`); hoy los topes están en los esquemas y en los runners.

## OpenCode Go: términos de uso y por qué no abusar
OpenCode Go es una suscripción con límites de uso (por ejemplo errores `token rate limit`). Este banco se usa con una cuenta propia y a ritmo humano razonable:
- Un banco de pruebas multiplica las llamadas: 100 runs de 60 pasos son miles de peticiones. Sin topes agota la cuota, bloquea tu trabajo real y puede considerarse uso abusivo o automatización no prevista por el plan.
- Antes de cualquier piloto, lee los términos vigentes del servicio (no se han copiado aquí, pueden cambiar) y confirma que la automatización y el reintento masivo están permitidos para tu plan. Si hay duda, no corras.
- Respeta los límites en lugar de esquivarlos: concurrencia 1, backoff con jitter, parar tras 3 reintentos, nunca rotar cuentas ni claves para sortear un límite.
- Un `rate_limited` no es fallo del agente: se excluye en PP y se reporta aparte. Si aparece repetidamente, detén el experimento.
