//! Incrusta el manifiesto (PerMonitorV2, asInvoker, sin uiAccess) y la versión con `windres` de mingw-w64 al compilar
//! para `windows-gnu`. Sin dependencias: si `windres` no está, avisa y sigue (el helper también fija el DPI por código).
use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=cu-helper.rc");
    println!("cargo:rerun-if-changed=cu-helper.manifest");
    println!("cargo:rerun-if-env-changed=WINDRES");
    let target = env::var("TARGET").unwrap_or_default();
    if !target.contains("windows-gnu") {
        return;
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("cu-helper-res.o");
    let windres = env::var("WINDRES").unwrap_or_else(|_| if cfg!(windows) { "windres".into() } else { "x86_64-w64-mingw32-windres".into() });
    let status = Command::new(&windres).args(["-i", "cu-helper.rc", "-o"]).arg(&out).status();
    match status {
        Ok(s) if s.success() => println!("cargo:rustc-link-arg-bins={}", out.display()),
        _ => println!("cargo:warning=windres no disponible: el .exe sale sin manifiesto ni recurso de versión (pon WINDRES=ruta o instala mingw-w64)"),
    }
}
