//! Envoltorio PURO de la ejecución: analiza la línea de comandos, llama al ejecutor (en Windows, el real; en las
//! pruebas, uno falso) y convierte el resultado en (stdout, stderr, código de salida) respetando el contrato:
//! JSON de una línea por stdout, errores por stderr, y tope de salida de `MAX_OUTPUT_BYTES`.

use crate::commands::{parse_command, parse_globals, Command, Global};
use crate::exitcode::{CuError, CuResult};
use crate::json::Json;
use crate::limits::{MAX_OUTPUT_BYTES, PROTOCOL_VERSION};

/// Resultado de ejecutar un comando.
#[derive(Debug, Clone, PartialEq)]
pub struct Output {
    /// Línea JSON (None para los comandos de flujo, que escriben por su cuenta).
    pub json: Option<Json>,
    /// Código de salida (0 = correcto). Con código ≠ 0 y `json`, se imprime el JSON Y el mensaje.
    pub code: i32,
    /// Mensaje para stderr (aviso o error).
    pub note: Option<String>,
}

impl Output {
    pub fn ok(json: Json) -> Output {
        Output { json: Some(json), code: 0, note: None }
    }
    pub fn stream() -> Output {
        Output { json: None, code: 0, note: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub code: i32,
}

pub fn render(r: CuResult<Output>) -> Rendered {
    match r {
        Err(e) => Rendered { stdout: None, stderr: Some(e.msg), code: e.code },
        Ok(o) => {
            let line = o.json.as_ref().map(|j| j.to_line());
            if let Some(l) = &line {
                if l.len() + 1 > MAX_OUTPUT_BYTES {
                    return Rendered { stdout: None, stderr: Some("La salida supera el tope de 4 MiB".into()), code: crate::exitcode::GENERIC };
                }
            }
            Rendered { stdout: line, stderr: o.note, code: o.code }
        }
    }
}

/// Analiza `argv` (sin el nombre del programa) y ejecuta con `exec`.
pub fn run_cli(argv: &[String], env: &dyn Fn(&str) -> Option<String>, exec: impl FnOnce(&Global, &Command) -> CuResult<Output>) -> Rendered {
    let parsed = parse_globals(argv, env).and_then(|(g, rest)| parse_command(&rest).map(|c| (g, c)));
    render(parsed.and_then(|(g, c)| if matches!(c, Command::Version) { Ok(version_output()) } else { exec(&g, &c) }))
}

/// Respuesta de `version`: protocolo del contrato, programa y plataforma. Pura: no toca el escritorio.
pub fn version_output() -> Output {
    Output::ok(Json::obj([
        ("protocol", Json::num(PROTOCOL_VERSION)),
        ("helper", Json::str(format!("cu-helper-{}", env!("CARGO_PKG_VERSION")))),
        ("platform", Json::str("win32")),
    ]))
}

pub fn not_windows() -> CuError {
    CuError::unavailable("cu-helper solo funciona en Windows")
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

    #[test]
    fn json_por_stdout_y_error_por_stderr() {
        let r = run_cli(&v(&["cursor"]), &no_env, |_, _| Ok(Output::ok(Json::obj([("y", Json::num(2)), ("x", Json::num(1))]))));
        assert_eq!(r, Rendered { stdout: Some("{\"x\":1,\"y\":2}".into()), stderr: None, code: 0 });
        let r = run_cli(&v(&["move", "1"]), &no_env, |_, _| unreachable!());
        assert_eq!(r.code, 1);
        assert!(r.stdout.is_none() && r.stderr.unwrap().contains("Falta o es inválido"));
        let r = run_cli(&v(&["cursor"]), &no_env, |_, _| Err(CuError::unavailable("sin sesión")));
        assert_eq!((r.code, r.stderr.as_deref(), r.stdout), (12, Some("sin sesión"), None));
    }

    #[test]
    fn las_banderas_llegan_al_ejecutor() {
        let r = run_cli(&v(&["--instant", "--char-delay=3", "cursor"]), &no_env, |g, c| {
            assert!(g.instant && g.char_delay_ms == 3.0);
            assert_eq!(*c, Command::Cursor);
            Ok(Output::stream())
        });
        assert_eq!(r, Rendered { stdout: None, stderr: None, code: 0 });
    }

    #[test]
    fn salida_con_codigo_distinto_de_cero_imprime_json_y_mensaje() {
        let r = run_cli(&v(&["session"]), &no_env, |_, _| {
            Ok(Output { json: Some(Json::obj([("interactive", Json::Bool(false))])), code: 12, note: Some("Sin escritorio interactivo".into()) })
        });
        assert_eq!((r.code, r.stdout.as_deref(), r.stderr.as_deref()), (12, Some("{\"interactive\":false}"), Some("Sin escritorio interactivo")));
    }

    #[test]
    fn tope_de_salida() {
        let big = Json::Arr(vec![Json::str("x".repeat(1024 * 1024)); 5]);
        let r = run_cli(&v(&["cursor"]), &no_env, |_, _| Ok(Output::ok(big)));
        assert_eq!(r.code, 1);
        assert!(r.stdout.is_none());
        let fits = Json::Arr(vec![Json::str("x".repeat(1024 * 1024)); 3]);
        assert_eq!(run_cli(&v(&["cursor"]), &no_env, |_, _| Ok(Output::ok(fits))).code, 0);
    }

    #[test]
    fn version_se_responde_sin_ejecutor() {
        let r = run_cli(&v(&["version"]), &no_env, |_, _| unreachable!());
        assert_eq!(r.code, 0);
        let j = crate::json::parse(r.stdout.as_deref().unwrap()).unwrap();
        assert_eq!(j.get("protocol").and_then(|x| x.as_f64()), Some(1.0));
        assert_eq!(j.get("platform").and_then(|x| x.as_str()), Some("win32"));
        assert!(j.get("helper").and_then(|x| x.as_str()).is_some_and(|h| h.starts_with("cu-helper-")));
        // con banderas globales delante también
        assert_eq!(run_cli(&v(&["--instant", "version"]), &no_env, |_, _| unreachable!()).code, 0);
    }

    #[test]
    fn comando_desconocido_o_sin_comando() {
        assert_eq!(run_cli(&v(&["format-c"]), &no_env, |_, _| unreachable!()).code, 1);
        let r = run_cli(&[], &no_env, |_, _| unreachable!());
        assert_eq!(r.code, 1);
        assert!(r.stderr.unwrap().starts_with("Uso: cu-helper"));
    }
}
