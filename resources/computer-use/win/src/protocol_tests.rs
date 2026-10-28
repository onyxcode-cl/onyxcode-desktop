//! El helper frente al contrato `resources/computer-use/protocol.json` (el mismo que valida
//! `src/test/cu-protocol.test.ts` contra el helper de macOS): comandos, argumentos obligatorios, límites y códigos.

use crate::commands::{parse_command, Command, DEFERRED, IMPLEMENTED, UNAVAILABLE};
use crate::exitcode::USED;
use crate::json::{parse, Json};
use crate::limits::*;
use crate::roles::ACTION_NAMES;
use std::collections::BTreeSet;

const PROTOCOL: &str = include_str!("../../protocol.json");

fn proto() -> Json {
    parse(PROTOCOL).expect("protocol.json es JSON válido")
}

fn names(j: &Json) -> BTreeSet<String> {
    j.as_object().unwrap().keys().cloned().collect()
}

#[test]
fn comandos_del_contrato_cubiertos() {
    let p = proto();
    let commands = p.get("commands").unwrap();
    let ext = p.get("windowsExtensions").unwrap();
    for (name, c) in commands.as_object().unwrap() {
        let win = c.get("win32").and_then(|v| v.as_str()).unwrap();
        match win {
            "same" => assert!(IMPLEMENTED.contains(&name.as_str()) || DEFERRED.contains(&name.as_str()), "{name} sin tratar"),
            "none" | "replaced" => assert!(UNAVAILABLE.iter().any(|(n, _)| n == name), "{name} debe ser «no disponible»"),
            o => panic!("win32 desconocido {o} en {name}"),
        }
    }
    for (n, _) in UNAVAILABLE {
        let w = commands.get(n).and_then(|c| c.get("win32")).and_then(|v| v.as_str());
        assert!(matches!(w, Some("none" | "replaced")), "{n}");
    }
    for n in DEFERRED {
        assert_eq!(commands.get(n).and_then(|c| c.get("win32")).and_then(|v| v.as_str()), Some("same"), "{n}");
    }
    for n in IMPLEMENTED {
        assert!(commands.get(n).is_some() || ext.get(n).is_some(), "{n} no figura en el contrato");
    }
    for n in names(ext) {
        assert!(IMPLEMENTED.contains(&n.as_str()), "extensión {n} sin implementar");
    }
    let mut all: Vec<&str> = IMPLEMENTED.to_vec();
    all.sort_unstable();
    let before = all.len();
    all.dedup();
    assert_eq!(before, all.len(), "IMPLEMENTED con duplicados");
}

#[test]
fn argumentos_obligatorios() {
    let p = proto();
    let mut cmds: Vec<(String, Json)> = p.get("commands").unwrap().as_object().unwrap().clone().into_iter().collect();
    cmds.extend(p.get("windowsExtensions").unwrap().as_object().unwrap().clone());
    for (name, c) in cmds {
        let win = c.get("win32").and_then(|v| v.as_str()).unwrap();
        if win != "same" || DEFERRED.contains(&name.as_str()) {
            continue;
        }
        let required = c.get("args").unwrap().as_array().unwrap().iter().any(|a| a.get("required").and_then(|r| r.as_bool()) == Some(true));
        let flag_required = c.get("flags").and_then(|f| f.as_array()).is_some_and(|f| f.iter().any(|a| a.get("required").and_then(|r| r.as_bool()) == Some(true)));
        let r = parse_command(std::slice::from_ref(&name));
        if required || flag_required {
            assert!(r.is_err(), "{name} sin argumentos debe fallar");
        } else {
            assert!(r.is_ok(), "{name} sin argumentos debe ser válido: {r:?}");
        }
    }
}

#[test]
fn limites_y_valores_del_contrato() {
    let p = proto();
    let io = p.get("io").unwrap();
    assert_eq!(io.get("timeoutMs").unwrap().as_f64(), Some(CALLER_TIMEOUT_MS as f64));
    assert_eq!(io.get("maxOutputBytes").unwrap().as_f64(), Some(MAX_OUTPUT_BYTES as f64));
    let cmds = p.get("commands").unwrap();
    let tree = cmds.get("ax-tree").unwrap().get("args").unwrap().as_array().unwrap();
    assert_eq!(tree[1].get("default").unwrap().as_f64(), Some(TREE_MAX_DEPTH as f64));
    assert_eq!(tree[2].get("default").unwrap().as_f64(), Some(TREE_MAX_NODES as f64));
    let act: Vec<&str> = cmds.get("ax-action").unwrap().get("args").unwrap().as_array().unwrap()[2]
        .get("values")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(act, ACTION_NAMES.to_vec());
    let click = cmds.get("click").unwrap().get("args").unwrap().as_array().unwrap();
    assert_eq!(click[2].get("values").unwrap().as_array().unwrap().len(), 2);
    assert_eq!(click[3].get("max").unwrap().as_f64(), Some(3.0));
    let shot = p.get("windowsExtensions").unwrap().get("screenshot").unwrap().get("flags").unwrap().as_array().unwrap();
    let default_of = |n: &str| shot.iter().find(|f| f.get("name").unwrap().as_str() == Some(n)).and_then(|f| f.get("default")).and_then(|d| d.as_f64());
    assert_eq!(default_of("--max-long"), Some(CAPTURE_DEFAULT_LONG as f64));
    assert_eq!(default_of("--quality"), Some(JPEG_DEFAULT_QUALITY as f64));
    // window-shot: banderas aditivas de Windows (recorte y sonda) y campos opcionales de la salida.
    let ws = cmds.get("window-shot").unwrap();
    let flags: Vec<&str> = ws.get("win32Flags").unwrap().as_array().unwrap().iter().map(|f| f.get("name").unwrap().as_str().unwrap()).collect();
    for f in ["--max-long", "--quality", "--crop", "--probe"] {
        assert!(flags.contains(&f), "window-shot sin {f} en win32Flags");
    }
    let out = ws.get("win32Output").unwrap();
    for k in ["x", "y", "srcWidth", "srcHeight", "frame", "crop", "covered", "coveredPct"] {
        assert!(out.get(k).is_some(), "window-shot.win32Output sin {k}");
    }
    // `covered` solo declara nombre y porcentaje.
    let item = &out.get("covered").unwrap().as_array().unwrap()[0];
    let mut keys: Vec<&str> = item.as_object().unwrap().keys().map(|k| k.as_str()).filter(|k| !k.starts_with('_')).collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["name", "pct"]);
}

#[test]
fn codigos_de_salida() {
    let p = proto();
    let codes = p.get("exitCodes").unwrap();
    for c in USED {
        let e = codes.get(&c.to_string()).unwrap_or_else(|| panic!("código {c} fuera del contrato"));
        if let Some(pl) = e.get("platforms").and_then(|x| x.as_array()) {
            assert!(pl.iter().any(|v| v.as_str() == Some("win32")), "código {c} no es de Windows");
        }
    }
    // Los de macOS (4, 5, 6) y el 2 no los usa este helper.
    for c in [2, 4, 5, 6] {
        assert!(!USED.contains(&c));
    }
    // Todo código que algún comando de Windows declara debe poder devolverse (o ser exclusivo de macOS).
    let cmds = p.get("commands").unwrap();
    for (name, cmd) in cmds.as_object().unwrap() {
        if cmd.get("win32").and_then(|v| v.as_str()) != Some("same") {
            continue;
        }
        for e in cmd.get("exits").unwrap().as_array().unwrap() {
            let c = e.as_f64().unwrap() as i32;
            assert!(USED.contains(&c) || [2, 4, 5, 6].contains(&c), "{name} declara la salida {c}");
        }
    }
}

#[test]
fn el_comando_desconocido_y_los_diferidos() {
    assert!(matches!(parse_command(&["open-app".into(), "Notepad".into()]), Ok(Command::Deferred { .. })));
    assert_eq!(parse_command(&["nope".into()]).unwrap_err().code, 1);
}

#[test]
fn version_del_protocolo_y_salida_de_version() {
    let p = proto();
    assert_eq!(p.get("version").unwrap().as_f64(), Some(PROTOCOL_VERSION as f64));
    assert_eq!(p.get("win32Contract").unwrap().get("protocol").unwrap().as_f64(), Some(PROTOCOL_VERSION as f64));
    let out = crate::cli::version_output().json.unwrap();
    let want = p.get("windowsExtensions").unwrap().get("version").unwrap().get("output").unwrap();
    assert_eq!(names(want), names(&out));
    assert_eq!(out.get("platform").and_then(|v| v.as_str()), Some("win32"));
}
