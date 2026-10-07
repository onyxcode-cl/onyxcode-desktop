//! Línea de comandos del helper: banderas globales, comandos y validación de argumentos. PURO.
//! Mismo protocolo que el helper de macOS (`helper.swift`) y que `resources/computer-use/protocol.json`:
//! `cu-helper [--instant] [--char-delay <ms>] <comando> args…`; JSON por stdout y errores por stderr.

use crate::appkey::{parse_app_key, AppKey};
use crate::exitcode::{CuError, CuResult};
use crate::fuzzy::fold_text;
use crate::json::{self, Json};
use crate::limits::*;
use crate::roles::{normalize_role, parse_ref, UiaAction};

#[derive(Debug, Clone, PartialEq)]
pub struct Global {
    pub instant: bool,
    pub char_delay_ms: f64,
}

/// Consulta de `ax-find`: `{role?, title?, text?, limit?≤50}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxQuery {
    pub role: Option<String>,
    pub title: Option<String>,
    pub text: Option<String>,
    pub limit: usize,
}

/// Lo que se compara de un nodo (nunca incluye el valor de un campo seguro: el llamador lo deja en `None`).
#[derive(Debug, Clone, Default)]
pub struct NodeView<'a> {
    pub role: &'a str,
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub value: Option<&'a str>,
}

impl AxQuery {
    pub fn matches(&self, n: &NodeView) -> bool {
        if let Some(r) = &self.role {
            let want = normalize_role(r).map(|s| s.to_lowercase()).unwrap_or_else(|| r.trim().to_lowercase());
            if n.role.to_lowercase() != want {
                return false;
            }
        }
        if let Some(t) = &self.title {
            if !fold_text(n.title.unwrap_or("")).contains(&fold_text(t)) {
                return false;
            }
        }
        if let Some(t) = &self.text {
            let hay = [n.title, n.description, n.value].iter().flatten().copied().collect::<Vec<_>>().join(" ");
            if !fold_text(&hay).contains(&fold_text(t)) {
                return false;
            }
        }
        true
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Move { x: f64, y: f64 },
    Click { x: f64, y: f64, right: bool, count: u8 },
    Drag { x1: f64, y1: f64, x2: f64, y2: f64 },
    Scroll { x: f64, y: f64, dx: f64, dy: f64 },
    Type { text: String },
    Key { combos: String },
    Cursor,
    Screens,
    Permissions,
    Frontmost,
    AppAt { x: f64, y: f64 },
    RunningApps,
    ListApps,
    WindowsOf { keys: Vec<AppKey> },
    FocusedSecure,
    RecentInput,
    WatchEsc,
    Activate { target: String },
    HideApps { keep: Vec<AppKey> },
    UnhideApps { list: Vec<AppKey> },
    AxTree { app: AppKey, max_depth: usize, max_nodes: usize },
    AxFind { app: AppKey, query: AxQuery },
    AxFrame { app: AppKey, path: Vec<usize> },
    AxPress { app: AppKey, path: Vec<usize>, expect_role: Option<String>, expect_title: Option<String> },
    AxSetValue { app: AppKey, path: Vec<usize>, value: String },
    AxAction { app: AppKey, path: Vec<usize>, action: UiaAction },
    FindElements { app: AppKey, roles: Option<Vec<String>>, query: Option<String> },
    WindowShot { app: AppKey, out: String, index: usize, max_long: i64, quality: i64 },
    Screenshot { out: String, max_long: i64, quality: i64, mask_keys: Vec<AppKey> },
    ReleaseInput,
    Session,
    /// `version`: protocolo y programa. Se responde sin tocar el escritorio (ver `cli::run_cli`).
    Version,
    /// `resolve-app`: busca entre las apps con ventana visible (no lanza ni abre nada).
    ResolveApp { query: String },
    /// Comando del contrato que esta versión del helper de Windows aún no implementa (salida 12).
    Deferred { name: &'static str },
    /// Comando del contrato que NO existe en Windows (`win32: none|replaced`): salida 12 con el motivo.
    Unavailable { name: &'static str, reason: &'static str },
}

/// Comandos del contrato con `win32: same` que esta tanda deja sin implementar (salida 12 «no implementado»).
pub const DEFERRED: [&str; 2] = ["open-app", "open-app-bg"];

/// Comandos sin equivalente en Windows (`win32: none|replaced`) y su motivo.
pub const UNAVAILABLE: [(&str, &str); 7] = [
    ("request-permissions", "no aplica en Windows: el consentimiento lo pide la propia app (Ajustes)"),
    ("screenshot-sck", "reemplazado en Windows por `screenshot`"),
    ("mask-regions", "reemplazado en Windows: la máscara la aplica `screenshot --mask-keys`"),
    ("record", "fuera de la v1 de Windows"),
    ("transcribe", "no disponible en Windows"),
    ("mic-permission", "no disponible en Windows"),
    ("mic-request", "no disponible en Windows"),
];

/// Todos los comandos implementados (lo que figura en la línea de uso).
pub const IMPLEMENTED: [&str; 33] = [
    "move", "click", "drag", "scroll", "type", "key", "cursor", "screens", "permissions", "frontmost", "app-at", "running-apps",
    "list-apps", "windows-of", "focused-secure", "recent-input", "watch-esc", "activate", "hide-apps", "unhide-apps", "ax-tree",
    "ax-find", "ax-frame", "ax-press", "ax-set-value", "ax-action", "find-elements", "window-shot", "screenshot",
    "release-input", "session", "version", "resolve-app",
];

pub fn usage() -> String {
    let mut all: Vec<&str> = IMPLEMENTED.to_vec();
    all.extend(DEFERRED);
    all.extend(UNAVAILABLE.iter().map(|(n, _)| *n));
    all.sort_unstable();
    all.dedup();
    format!("Uso: cu-helper [--instant] [--char-delay <ms>] {} …", all.join("|"))
}

fn err(msg: impl Into<String>) -> CuError {
    CuError::generic(msg)
}

fn num(args: &[String], i: usize, name: &str) -> CuResult<f64> {
    let v = args.get(i).and_then(|s| s.trim().parse::<f64>().ok()).filter(|v| v.is_finite() && v.abs() <= 1.0e7);
    v.ok_or_else(|| err(format!("Falta o es inválido el argumento {name}")))
}

fn int(s: &str, name: &str) -> CuResult<i64> {
    s.trim().parse::<i64>().map_err(|_| err(format!("Argumento {name} inválido: debe ser un entero")))
}

fn text_arg(args: &[String], from: usize, missing: &str) -> CuResult<String> {
    if args.len() <= from {
        return Err(err(missing));
    }
    let t = args[from..].join(" ");
    if t.chars().count() > MAX_ARG_CHARS {
        return Err(err("Argumento demasiado largo"));
    }
    Ok(t)
}

fn key_arg(args: &[String], i: usize, what: &str) -> CuResult<AppKey> {
    let raw = args.get(i).ok_or_else(|| err(format!("Falta {what}")))?;
    parse_app_key(raw).map_err(|e| err(format!("{what}: {e}")))
}

/// Lista de claves (`windows-of`, `hide-apps`, `unhide-apps`): separadas por coma, cada una con `%` y `,` codificados (%25, %2C), igual que
/// `--mask-keys`. Sin esto, el editor de una app firmada con coma («Brave Software, Inc.») partía la clave y la lista fallaba.
fn key_list(raw: &str) -> CuResult<Vec<AppKey>> {
    mask_key_list(raw)
}

fn ref_arg(args: &[String], i: usize) -> CuResult<Vec<usize>> {
    let raw = args.get(i).ok_or_else(|| err("Falta la referencia (ref) del elemento"))?;
    parse_ref(raw).map_err(err)
}

/// Decodifica un elemento de `--mask-keys`: solo `%25` (`%`) y `%2C` (`,`); cualquier otro `%` se rechaza.
pub fn decode_key_item(raw: &str) -> CuResult<String> {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        if tail.len() >= 3 && tail.is_char_boundary(3) && tail[..3].eq_ignore_ascii_case("%25") {
            out.push('%');
        } else if tail.len() >= 3 && tail.is_char_boundary(3) && tail[..3].eq_ignore_ascii_case("%2C") {
            out.push(',');
        } else {
            return Err(err("Lista de claves: secuencia % no válida (solo %25 y %2C)"));
        }
        rest = &tail[3..];
    }
    out.push_str(rest);
    Ok(out)
}

/// `--mask-keys`: elementos separados por coma, cada uno con `%` y `,` codificados.
fn mask_key_list(raw: &str) -> CuResult<Vec<AppKey>> {
    let parts: Vec<&str> = raw.split(',').filter(|s| !s.trim().is_empty()).collect();
    if parts.len() > MAX_KEYS_PER_CALL {
        return Err(err("Demasiadas apps en la lista"));
    }
    parts
        .iter()
        .map(|p| decode_key_item(p.trim()).and_then(|d| parse_app_key(&d).map_err(|e| err(format!("Lista de apps: {e}")))))
        .collect()
}

/// Separa los posicionales de las banderas de captura (`--max-long`, `--quality` y, si se permite, `--mask-keys`),
/// con valor aparte o `--bandera=valor`. Devuelve (posicionales desde `from`, lado largo, calidad, claves a tapar).
#[allow(clippy::type_complexity)]
fn shot_flags(args: &[String], from: usize, allow_mask: bool, usage: &str) -> CuResult<(Vec<String>, i64, i64, Vec<AppKey>)> {
    let (mut pos, mut max_long, mut quality, mut mask) = (Vec::new(), CAPTURE_DEFAULT_LONG, JPEG_DEFAULT_QUALITY, Vec::new());
    let mut i = from;
    while i < args.len() {
        let a = &args[i];
        let (flag, inline) = match a.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (a.as_str(), None),
        };
        if !flag.starts_with("--") {
            pos.push(a.clone());
            i += 1;
            continue;
        }
        if !matches!(flag, "--max-long" | "--quality") && !(allow_mask && flag == "--mask-keys") {
            return Err(err(format!("Bandera desconocida: {} ({usage})", json::clip(flag, 40))));
        }
        let (val, step) = match inline {
            Some(v) => (v, 1),
            None => (args.get(i + 1).cloned().ok_or_else(|| err(format!("Falta el valor de {flag}")))?, 2),
        };
        match flag {
            "--max-long" => max_long = clamp_i64(int(&val, "--max-long")?, CAPTURE_MIN_LONG, CAPTURE_MAX_LONG),
            "--quality" => quality = clamp_i64(int(&val, "--quality")?, 1, 100),
            _ => mask = mask_key_list(&val)?,
        }
        i += step;
    }
    Ok((pos, max_long, quality, mask))
}

/// Aplica banderas globales y devuelve (opciones, resto). Las banderas van ANTES del comando.
pub fn parse_globals(argv: &[String], env: &dyn Fn(&str) -> Option<String>) -> CuResult<(Global, Vec<String>)> {
    let mut g = Global {
        instant: env("CU_INSTANT").as_deref() == Some("1"),
        char_delay_ms: env("CU_CHAR_DELAY_MS").and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| v.is_finite()).unwrap_or(14.0),
    };
    let mut rest: Vec<String> = argv.to_vec();
    let clamp = |v: f64| v.clamp(0.0, 1000.0);
    g.char_delay_ms = clamp(g.char_delay_ms);
    while let Some(f) = rest.first().cloned() {
        if !f.starts_with("--") {
            break;
        }
        rest.remove(0);
        if f == "--instant" {
            g.instant = true;
        } else if f == "--char-delay" {
            let v = num(&rest, 0, "--char-delay")?;
            g.char_delay_ms = clamp(v);
            rest.remove(0);
        } else if let Some(v) = f.strip_prefix("--char-delay=") {
            g.char_delay_ms = clamp(v.trim().parse::<f64>().ok().filter(|v| v.is_finite()).ok_or_else(|| err("Valor inválido de --char-delay"))?);
        } else {
            return Err(err(format!("Bandera desconocida: {f}")));
        }
    }
    Ok((g, rest))
}

pub fn parse_ax_query(raw: &str) -> CuResult<AxQuery> {
    let j = json::parse(raw).map_err(|e| err(format!("Consulta JSON inválida para ax-find: {e}")))?;
    let Json::Obj(_) = j else { return Err(err("Consulta JSON inválida para ax-find: debe ser un objeto")) };
    let s = |k: &str| j.get(k).and_then(|v| v.as_str()).map(|v| json::clip(v, 200));
    let limit = match j.get("limit").and_then(|v| v.as_f64()) {
        Some(n) if n.fract() == 0.0 => (n as i64).clamp(1, FIND_MAX_RESULTS as i64) as usize,
        _ => FIND_MAX_RESULTS,
    };
    Ok(AxQuery { role: s("role"), title: s("title"), text: s("text"), limit })
}

/// Analiza `cmd args…` (sin las banderas globales).
pub fn parse_command(rest: &[String]) -> CuResult<Command> {
    let Some(cmd) = rest.first() else { return Err(err(usage())) };
    let args = rest;
    Ok(match cmd.as_str() {
        "move" => Command::Move { x: num(args, 1, "x")?, y: num(args, 2, "y")? },
        "click" => {
            let right = match args.get(3).map(|s| s.to_lowercase()) {
                None => false,
                Some(b) if b == "left" => false,
                Some(b) if b == "right" => true,
                Some(_) => return Err(err("El botón debe ser left o right")),
            };
            let count = match args.get(4) {
                None => 1,
                Some(c) => int(c, "count")?.clamp(1, 3) as u8,
            };
            Command::Click { x: num(args, 1, "x")?, y: num(args, 2, "y")?, right, count }
        }
        "drag" => Command::Drag { x1: num(args, 1, "x1")?, y1: num(args, 2, "y1")?, x2: num(args, 3, "x2")?, y2: num(args, 4, "y2")? },
        "scroll" => Command::Scroll { x: num(args, 1, "x")?, y: num(args, 2, "y")?, dx: num(args, 3, "dx")?, dy: num(args, 4, "dy")? },
        "type" => Command::Type { text: text_arg(args, 1, "Falta el texto")? },
        "key" => Command::Key { combos: text_arg(args, 1, "Falta la combinación")? },
        "cursor" => Command::Cursor,
        "screens" => Command::Screens,
        "permissions" => Command::Permissions,
        "frontmost" => Command::Frontmost,
        "app-at" => Command::AppAt { x: num(args, 1, "x")?, y: num(args, 2, "y")? },
        "running-apps" => Command::RunningApps,
        "list-apps" => Command::ListApps,
        "windows-of" => {
            let raw = args.get(1).ok_or_else(|| err("Falta la lista de claves de app (separadas por coma)"))?;
            Command::WindowsOf { keys: key_list(raw)? }
        }
        "focused-secure" => Command::FocusedSecure,
        "recent-input" => Command::RecentInput,
        "watch-esc" => Command::WatchEsc,
        "activate" => Command::Activate { target: text_arg(args, 1, "Falta la clave o el nombre de la app")? },
        "hide-apps" => Command::HideApps { keep: key_list(args.get(1).ok_or_else(|| err("Uso: cu-helper hide-apps <keepCsv>"))?)? },
        "unhide-apps" => Command::UnhideApps { list: key_list(args.get(1).ok_or_else(|| err("Uso: cu-helper unhide-apps <csv>"))?)? },
        "ax-tree" => {
            let app = key_arg(args, 1, "la clave de app")?;
            let d = match args.get(2) {
                Some(v) => int(v, "maxDepth")?,
                None => TREE_MAX_DEPTH,
            };
            let n = match args.get(3) {
                Some(v) => int(v, "maxNodes")?,
                None => TREE_MAX_NODES,
            };
            Command::AxTree {
                app,
                max_depth: clamp_i64(d, 0, TREE_MAX_DEPTH) as usize,
                max_nodes: clamp_i64(n, 1, TREE_MAX_NODES) as usize,
            }
        }
        "ax-find" => {
            let app = key_arg(args, 1, "la clave de app")?;
            let q = args.get(2).ok_or_else(|| err("Uso: cu-helper ax-find <appKey> <jsonQuery>"))?;
            Command::AxFind { app, query: parse_ax_query(q)? }
        }
        "ax-frame" => Command::AxFrame { app: key_arg(args, 1, "la clave de app")?, path: ref_arg(args, 2)? },
        "ax-press" => {
            let app = key_arg(args, 1, "la clave de app")?;
            let path = ref_arg(args, 2)?;
            let expect_role = args.get(3).filter(|s| !s.is_empty()).cloned();
            let expect_title = if args.len() > 4 { Some(args[4..].join(" ")).filter(|s| !s.is_empty()) } else { None };
            Command::AxPress { app, path, expect_role, expect_title }
        }
        "ax-set-value" => {
            if args.len() <= 3 {
                return Err(err("Uso: cu-helper ax-set-value <appKey> <ref> <valor…>"));
            }
            Command::AxSetValue { app: key_arg(args, 1, "la clave de app")?, path: ref_arg(args, 2)?, value: text_arg(args, 3, "Falta el valor")? }
        }
        "ax-action" => {
            if args.len() <= 3 {
                return Err(err("Uso: cu-helper ax-action <appKey> <ref> <acción>"));
            }
            // La lista cerrada se comprueba ANTES de resolver app o elemento (como el helper de macOS).
            let action = UiaAction::parse(&args[3]).ok_or_else(|| CuError::not_allowed(format!("Acción no permitida: {}", json::clip(&args[3], 40))))?;
            Command::AxAction { app: key_arg(args, 1, "la clave de app")?, path: ref_arg(args, 2)?, action }
        }
        "find-elements" => {
            let (mut app, mut role, mut query) = (None, None, None);
            let mut i = 1;
            while i < args.len() {
                let slot = match args[i].as_str() {
                    "--app" => &mut app,
                    "--role" => &mut role,
                    "--query" => &mut query,
                    other => return Err(err(format!("Bandera desconocida para find-elements: {}", json::clip(other, 40)))),
                };
                let v = args.get(i + 1).ok_or_else(|| err(format!("Falta el valor de {}", args[i])))?;
                *slot = Some(v.clone());
                i += 2;
            }
            let app = app.filter(|a| !a.is_empty()).ok_or_else(|| err("Uso: cu-helper find-elements --app <appKey> [--role button,edit,…] [--query \"texto\"]"))?;
            let roles = role.map(|r| {
                r.split(',')
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| normalize_role(s).map(String::from).unwrap_or_else(|| s.trim().to_lowercase()))
                    .collect::<Vec<_>>()
            });
            Command::FindElements {
                app: parse_app_key(&app).map_err(|e| err(format!("--app: {e}")))?,
                roles,
                query: query.map(|q| fold_text(&json::clip(&q, 200))),
            }
        }
        "window-shot" => {
            let usage = "Uso: cu-helper window-shot <appKey> <outPath> [windowIndex=0] [--max-long N] [--quality N]";
            let (pos, max_long, quality, _) = shot_flags(args, 1, false, usage)?;
            let app = key_arg(&pos, 0, "la clave de app")?;
            let out = pos.get(1).cloned().ok_or_else(|| err(usage))?;
            if pos.len() > 3 {
                return Err(err(usage));
            }
            let index = match pos.get(2) {
                Some(v) => usize::try_from(int(v, "windowIndex")?).map_err(|_| err("windowIndex no puede ser negativo"))?.min(1000),
                None => 0,
            };
            Command::WindowShot { app, out, index, max_long, quality }
        }
        "screenshot" => {
            let usage = "Uso: cu-helper screenshot <outPath> [--max-long N] [--quality N] [--mask-keys csv]";
            let (pos, max_long, quality, mask_keys) = shot_flags(args, 1, true, usage)?;
            if pos.len() != 1 {
                return Err(err(usage));
            }
            Command::Screenshot { out: pos[0].clone(), max_long, quality, mask_keys }
        }
        "version" => Command::Version,
        "resolve-app" => Command::ResolveApp { query: text_arg(args, 1, "Falta el nombre de la app")? },
        "release-input" => Command::ReleaseInput,
        "session" => Command::Session,
        other => {
            if let Some(n) = DEFERRED.iter().find(|n| **n == other) {
                return Ok(Command::Deferred { name: n });
            }
            if let Some((n, reason)) = UNAVAILABLE.iter().find(|(n, _)| *n == other) {
                return Ok(Command::Unavailable { name: n, reason });
            }
            return Err(err(format!("Comando desconocido: {}", json::clip(other, 40))));
        }
    })
}

impl Command {
    /// ¿Necesita el consentimiento de la app (y sesión interactiva, sin elevar)? Las consultas de solo metadatos no.
    pub fn needs_control(&self) -> bool {
        !matches!(
            self,
            Command::Cursor
                | Command::Screens
                | Command::Permissions
                | Command::Frontmost
                | Command::AppAt { .. }
                | Command::RunningApps
                | Command::ListApps
                | Command::WindowsOf { .. }
                | Command::FocusedSecure
                | Command::RecentInput
                | Command::ReleaseInput
                | Command::Session
                | Command::Version
                | Command::ResolveApp { .. }
                | Command::Deferred { .. }
                | Command::Unavailable { .. }
        )
    }
    /// ¿Genera entrada real (ratón/teclado)? Vigilan stdin (STOP/EOF) y `COMPUTER_STOP_FILE`.
    pub fn is_input(&self) -> bool {
        matches!(self, Command::Move { .. } | Command::Click { .. } | Command::Drag { .. } | Command::Scroll { .. } | Command::Type { .. } | Command::Key { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }
    fn no_env(_: &str) -> Option<String> {
        None
    }
    const KEY: &str = "exe:c:\\windows\\notepad.exe|pub:(sin firma)";

    #[test]
    fn banderas_globales() {
        let (g, rest) = parse_globals(&v(&["--instant", "--char-delay", "30", "type", "--hola"]), &no_env).unwrap();
        assert!(g.instant);
        assert_eq!(g.char_delay_ms, 30.0);
        assert_eq!(rest, v(&["type", "--hola"]));
        let (g, rest) = parse_globals(&v(&["--char-delay=5", "cursor"]), &no_env).unwrap();
        assert!(!g.instant);
        assert_eq!((g.char_delay_ms, rest), (5.0, v(&["cursor"])));
        let env = |k: &str| match k {
            "CU_INSTANT" => Some("1".to_string()),
            "CU_CHAR_DELAY_MS" => Some("99999".to_string()),
            _ => None,
        };
        let (g, _) = parse_globals(&v(&["cursor"]), &env).unwrap();
        assert!(g.instant);
        assert_eq!(g.char_delay_ms, 1000.0);
        assert!(parse_globals(&v(&["--raro", "cursor"]), &no_env).is_err());
        assert!(parse_globals(&v(&["--char-delay"]), &no_env).is_err());
        assert!(parse_globals(&v(&["--char-delay=abc", "x"]), &no_env).is_err());
        // un texto de `type` nunca se interpreta como bandera
        let (_, rest) = parse_globals(&v(&["type", "--instant"]), &no_env).unwrap();
        assert_eq!(rest, v(&["type", "--instant"]));
    }

    #[test]
    fn raton_y_teclado() {
        assert_eq!(parse_command(&v(&["move", "10", "20.5"])).unwrap(), Command::Move { x: 10.0, y: 20.5 });
        assert_eq!(parse_command(&v(&["click", "1", "2"])).unwrap(), Command::Click { x: 1.0, y: 2.0, right: false, count: 1 });
        assert_eq!(parse_command(&v(&["click", "1", "2", "RIGHT", "9"])).unwrap(), Command::Click { x: 1.0, y: 2.0, right: true, count: 3 });
        assert_eq!(parse_command(&v(&["click", "1", "2", "left", "0"])).unwrap(), Command::Click { x: 1.0, y: 2.0, right: false, count: 1 });
        assert!(parse_command(&v(&["click", "1", "2", "middle"])).is_err());
        assert!(parse_command(&v(&["click", "1", "2", "left", "x"])).is_err());
        assert!(parse_command(&v(&["click", "1"])).is_err());
        assert!(parse_command(&v(&["move", "nan", "1"])).is_err());
        assert!(parse_command(&v(&["move", "inf", "1"])).is_err());
        assert!(parse_command(&v(&["move", "1e9", "1"])).is_err());
        assert_eq!(parse_command(&v(&["type", "hola", "mundo"])).unwrap(), Command::Type { text: "hola mundo".into() });
        assert!(parse_command(&v(&["type"])).is_err());
        assert_eq!(parse_command(&v(&["key", "ctrl+a ctrl+c"])).unwrap(), Command::Key { combos: "ctrl+a ctrl+c".into() });
        assert!(parse_command(&v(&["key"])).is_err());
        assert_eq!(parse_command(&v(&["scroll", "5", "5", "0", "3"])).unwrap(), Command::Scroll { x: 5.0, y: 5.0, dx: 0.0, dy: 3.0 });
        assert!(parse_command(&v(&["drag", "1", "2", "3"])).is_err());
    }

    #[test]
    fn arbol_con_limites() {
        let c = parse_command(&v(&["ax-tree", KEY])).unwrap();
        assert_eq!(c, Command::AxTree { app: parse_app_key(KEY).unwrap(), max_depth: 12, max_nodes: 500 });
        let Command::AxTree { max_depth, max_nodes, .. } = parse_command(&v(&["ax-tree", KEY, "99", "99999"])).unwrap() else { panic!() };
        assert_eq!((max_depth, max_nodes), (12, 500));
        let Command::AxTree { max_depth, max_nodes, .. } = parse_command(&v(&["ax-tree", KEY, "-4", "0"])).unwrap() else { panic!() };
        assert_eq!((max_depth, max_nodes), (0, 1));
        assert!(parse_command(&v(&["ax-tree", KEY, "x"])).is_err());
        assert!(parse_command(&v(&["ax-tree", "com.apple.Safari"])).is_err());
        assert!(parse_command(&v(&["ax-tree"])).is_err());
    }

    #[test]
    fn busqueda_acotada() {
        let Command::AxFind { query, .. } = parse_command(&v(&["ax-find", KEY, r#"{"role":"button","title":"Guardar","limit":9999}"#])).unwrap() else { panic!() };
        assert_eq!(query.limit, 50);
        assert_eq!(query.role.as_deref(), Some("button"));
        let q = parse_ax_query(r#"{"limit":0}"#).unwrap();
        assert_eq!(q.limit, 1);
        assert_eq!(parse_ax_query("{}").unwrap().limit, 50);
        assert_eq!(parse_ax_query(r#"{"limit":2.5}"#).unwrap().limit, 50);
        for bad in ["", "[]", "nope", "\"x\"", "{\"a\":"] {
            assert!(parse_ax_query(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn coincidencia_de_nodos() {
        let q = parse_ax_query(r#"{"role":"button","title":"guardar"}"#).unwrap();
        assert!(q.matches(&NodeView { role: "Button", title: Some("Guardar como…"), ..Default::default() }));
        assert!(!q.matches(&NodeView { role: "Edit", title: Some("Guardar"), ..Default::default() }));
        assert!(!q.matches(&NodeView { role: "Button", title: None, ..Default::default() }));
        let t = parse_ax_query(r#"{"text":"música"}"#).unwrap();
        assert!(t.matches(&NodeView { role: "Text", value: Some("MUSICA clásica"), ..Default::default() }));
        assert!(t.matches(&NodeView { role: "Text", description: Some("Mi Música"), ..Default::default() }));
        assert!(!t.matches(&NodeView { role: "Text", ..Default::default() }));
        let r = parse_ax_query(r#"{"role":"Edit"}"#).unwrap();
        assert!(r.matches(&NodeView { role: "Edit", ..Default::default() }));
        let unk = parse_ax_query(r#"{"role":"zzz"}"#).unwrap();
        assert!(!unk.matches(&NodeView { role: "Edit", ..Default::default() }));
    }

    #[test]
    fn acciones_y_refs() {
        let c = parse_command(&v(&["ax-action", KEY, "w0.1.2", "AXPick"])).unwrap();
        assert!(matches!(c, Command::AxAction { action: UiaAction::Pick, .. }));
        // Acción fuera de la lista: 11 antes de mirar app o ref.
        let e = parse_command(&v(&["ax-action", "no-es-clave", "no-es-ref", "AXDelete"])).unwrap_err();
        assert_eq!(e.code, 11);
        assert_eq!(parse_command(&v(&["ax-action", KEY, "w0", "AXPress"])).unwrap_err().code, 11);
        assert_eq!(parse_command(&v(&["ax-frame", KEY, "m.0"])).unwrap_err().code, 1);
        assert!(parse_command(&v(&["ax-frame", KEY])).is_err());
        let Command::AxPress { expect_role, expect_title, .. } = parse_command(&v(&["ax-press", KEY, "w0", "Button", "Aceptar", "todo"])).unwrap() else { panic!() };
        assert_eq!((expect_role.as_deref(), expect_title.as_deref()), (Some("Button"), Some("Aceptar todo")));
        let Command::AxSetValue { value, .. } = parse_command(&v(&["ax-set-value", KEY, "w0.1", "a", "b"])).unwrap() else { panic!() };
        assert_eq!(value, "a b");
        assert!(parse_command(&v(&["ax-set-value", KEY, "w0.1"])).is_err());
    }

    #[test]
    fn find_elements_banderas() {
        let c = parse_command(&v(&["find-elements", "--app", KEY, "--role", "button,Text_Field,zzz", "--query", "Música"])).unwrap();
        let Command::FindElements { roles, query, .. } = c else { panic!() };
        assert_eq!(roles, Some(vec!["Button".into(), "Edit".into(), "zzz".into()]));
        assert_eq!(query.as_deref(), Some("musica"));
        assert!(parse_command(&v(&["find-elements"])).is_err());
        assert!(parse_command(&v(&["find-elements", "--app"])).is_err());
        assert!(parse_command(&v(&["find-elements", "--app", KEY, "--raro", "x"])).is_err());
    }

    #[test]
    fn capturas() {
        let c = parse_command(&v(&["screenshot", "C:\\t\\a.jpg"])).unwrap();
        assert_eq!(c, Command::Screenshot { out: "C:\\t\\a.jpg".into(), max_long: 1366, quality: 70, mask_keys: vec![] });
        let c = parse_command(&v(&["screenshot", "--max-long", "99999", "C:\\t\\a.jpg", "--quality=0", "--mask-keys", &format!("{KEY},aumid:a.b!c")])).unwrap();
        let Command::Screenshot { max_long, quality, mask_keys, .. } = c else { panic!() };
        assert_eq!((max_long, quality, mask_keys.len()), (4096, 1, 2));
        assert!(parse_command(&v(&["screenshot"])).is_err());
        assert!(parse_command(&v(&["screenshot", "a", "b"])).is_err());
        assert!(parse_command(&v(&["screenshot", "a", "--raro", "1"])).is_err());
        assert!(parse_command(&v(&["screenshot", "a", "--mask-keys", "chrome.exe"])).is_err());
        let c = parse_command(&v(&["window-shot", KEY, "C:\\t\\w.png", "2"])).unwrap();
        assert!(matches!(c, Command::WindowShot { index: 2, max_long: 1366, quality: 70, .. }));
        let c = parse_command(&v(&["window-shot", KEY, "C:\\t\\w.jpg", "--max-long", "800", "--quality=55"])).unwrap();
        assert!(matches!(c, Command::WindowShot { index: 0, max_long: 800, quality: 55, .. }));
        assert!(parse_command(&v(&["window-shot", KEY, "C:\\t\\w.jpg", "0", "9"])).is_err());
        assert!(parse_command(&v(&["window-shot", KEY, "C:\\t\\w.jpg", "--mask-keys", KEY])).is_err());
        assert!(parse_command(&v(&["window-shot", KEY, "C:\\t\\w.png", "-1"])).is_err());
    }

    #[test]
    fn claves_a_tapar_codificadas() {
        assert_eq!(decode_key_item("a%25b%2Cc%2c").unwrap(), "a%b,c,");
        assert!(decode_key_item("a%41").is_err() && decode_key_item("a%2").is_err() && decode_key_item("%").is_err());
        // una ruta con coma y con % llega íntegra y sigue siendo una clave canónica
        let k = "exe:c:\\a,b\\100%\\x.exe|pub:(sin firma)";
        let enc = k.replace('%', "%25").replace(',', "%2C");
        let c = parse_command(&v(&["screenshot", "o.jpg", "--mask-keys", &format!("{enc},aumid:a.b!c")])).unwrap();
        let Command::Screenshot { mask_keys, .. } = c else { panic!() };
        assert_eq!(mask_keys.len(), 2);
        assert_eq!(mask_keys[0].to_key_string(), k);
        // sin codificar, la coma parte la ruta en dos claves inválidas: rechazo (falla cerrado)
        assert!(parse_command(&v(&["screenshot", "o.jpg", "--mask-keys", k])).is_err());
    }

    #[test]
    fn version_y_resolve_app() {
        assert_eq!(parse_command(&v(&["version"])).unwrap(), Command::Version);
        assert!(matches!(parse_command(&v(&["resolve-app", "Bloc", "de", "notas"])).unwrap(), Command::ResolveApp { query } if query == "Bloc de notas"));
        assert!(parse_command(&v(&["resolve-app"])).is_err());
        assert!(!Command::Version.needs_control() && !Command::ResolveApp { query: "x".into() }.needs_control());
    }

    #[test]
    fn apps_y_listas() {
        let Command::WindowsOf { keys } = parse_command(&v(&["windows-of", &format!("{KEY},aumid:a.b!c,")])).unwrap() else { panic!() };
        assert_eq!(keys.len(), 2);
        let too_many = (0..257).map(|i| format!("aumid:a{i}")).collect::<Vec<_>>().join(",");
        assert!(parse_command(&v(&["windows-of", &too_many])).is_err());
        assert!(parse_command(&v(&["windows-of", "chrome"])).is_err());
        assert!(matches!(parse_command(&v(&["hide-apps", ""])).unwrap(), Command::HideApps { keep } if keep.is_empty()));
        assert!(parse_command(&v(&["hide-apps"])).is_err());
        assert!(matches!(parse_command(&v(&["activate", "Bloc", "de", "notas"])).unwrap(), Command::Activate { target } if target == "Bloc de notas"));
    }

    #[test]
    fn diferidos_no_disponibles_y_desconocidos() {
        for n in DEFERRED {
            assert!(matches!(parse_command(&v(&[n, "x"])).unwrap(), Command::Deferred { .. }), "{n}");
        }
        for (n, _) in UNAVAILABLE {
            assert!(matches!(parse_command(&v(&[n])).unwrap(), Command::Unavailable { .. }), "{n}");
        }
        assert_eq!(parse_command(&v(&["format-c"])).unwrap_err().code, 1);
        assert!(parse_command(&[]).unwrap_err().msg.starts_with("Uso: cu-helper"));
    }

    #[test]
    fn clasificacion_de_comandos() {
        let c = |a: &[&str]| parse_command(&v(a)).unwrap();
        assert!(c(&["click", "1", "1"]).needs_control() && c(&["click", "1", "1"]).is_input());
        assert!(c(&["screenshot", "x"]).needs_control() && !c(&["screenshot", "x"]).is_input());
        assert!(c(&["watch-esc"]).needs_control());
        for n in ["cursor", "screens", "permissions", "frontmost", "running-apps", "list-apps", "focused-secure", "recent-input", "release-input", "session"] {
            assert!(!c(&[n]).needs_control(), "{n}");
        }
        assert!(!c(&["open-app", "x"]).needs_control());
    }

    #[test]
    fn uso_lista_todo() {
        let u = usage();
        for n in ["move", "ax-tree", "screenshot", "open-app", "record", "release-input", "session", "list-apps"] {
            assert!(u.contains(n), "{n}");
        }
    }

    #[test]
    fn listas_de_claves_decodifican_la_coma_del_editor() {
        // «Brave Software, Inc.» lleva coma: sin codificar partiría la clave en dos.
        let editor = "exe:c:\\program files\\brave\\brave.exe|pub:brave software, inc.";
        let enc = editor.replace('%', "%25").replace(',', "%2C");
        let lista = format!("{enc},aumid:microsoft.windowsterminal_8wekyb3d8bbwe!app");
        for cmd in ["windows-of", "hide-apps", "unhide-apps"] {
            let c = parse_command(&v(&[cmd, &lista])).unwrap();
            let keys = match c {
                Command::WindowsOf { keys } => keys,
                Command::HideApps { keep } => keep,
                Command::UnhideApps { list } => list,
                _ => panic!("comando inesperado"),
            };
            assert_eq!(keys.len(), 2, "{cmd}: la coma del editor no debe partir la clave");
        }
        // una `%` suelta se rechaza
        assert!(parse_command(&v(&["windows-of", "exe:c:\\a%zz.exe|pub:x"])).is_err());
    }
}
