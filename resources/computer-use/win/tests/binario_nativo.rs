//! Ejecuta el binario `cu-helper` compilado NATIVO (sin Windows) y comprueba solo la parte pura del contrato:
//! `version`, argumentos inválidos y códigos de salida. Lo que toca el escritorio (ratón, capturas, UIA) NO se prueba aquí.

use std::process::{Command, Output, Stdio};

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_cu-helper")).args(args).stdin(Stdio::null()).output().expect("lanzar cu-helper")
}

fn code(o: &Output) -> i32 {
    o.status.code().expect("salida con código")
}

#[test]
fn version_responde_el_protocolo_del_contrato() {
    let o = run(&["version"]);
    assert_eq!(code(&o), 0);
    let out = String::from_utf8(o.stdout).unwrap();
    assert!(out.ends_with('\n') && out.matches('\n').count() == 1, "una sola línea: {out:?}");
    let proto: String = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../protocol.json")).unwrap();
    let version = proto.split("\"version\": ").nth(1).and_then(|s| s.split(',').next()).unwrap().trim().to_string();
    assert!(out.contains(&format!("\"protocol\":{version}")), "{out}");
    assert!(out.contains("\"platform\":\"win32\"") && out.contains("\"helper\":\"cu-helper-"), "{out}");
    // claves ordenadas, como pide el contrato
    assert!(out.find("\"helper\"").unwrap() < out.find("\"platform\"").unwrap() && out.find("\"platform\"").unwrap() < out.find("\"protocol\"").unwrap());
}

#[test]
fn argumentos_invalidos_salen_con_1_y_mensaje_en_stderr() {
    for args in [
        &[][..],
        &["format-c"],
        &["move", "1"],
        &["click", "a", "b"],
        &["click", "1", "2", "middle"],
        &["screenshot"],
        &["screenshot", "a.jpg", "b.jpg"],
        &["screenshot", "a.jpg", "--mask-keys", "chrome.exe"],
        &["screenshot", "a.jpg", "--mask-keys", "aumid:a%41"],
        &["window-shot", "chrome.exe", "a.jpg"],
        &["window-shot", "aumid:a.b!c"],
        &["ax-action", "aumid:a.b!c", "w0.1"],
        &["--char-delay"],
        &["--raro", "cursor"],
    ] {
        let o = run(args);
        assert_eq!(code(&o), 1, "{args:?}");
        assert!(o.stdout.is_empty(), "{args:?}");
        assert!(!o.stderr.is_empty(), "{args:?}");
    }
}

#[test]
fn comandos_validos_fuera_de_windows_fallan_cerrado_con_12() {
    // Sintaxis correcta pero sin Windows: nada se ejecuta y la salida es 12 (recurso no disponible).
    for args in [&["cursor"][..], &["session"], &["list-apps"], &["screenshot", "a.jpg", "--max-long", "800", "--quality", "70"], &["record", "x"]] {
        assert_eq!(code(&run(args)), 12, "{args:?}");
    }
}
