//! Parada: `STOP`/EOF por stdin y `COMPUTER_STOP_FILE`. Al parar se SUELTA lo que el helper tiene pulsado y se sale
//! con el código 3 (en Windows no hay SIGTERM: TerminateProcess no deja soltar nada, por eso el llamador manda STOP
//! primero y luego ejecuta siempre `release-input`).

use super::input;
use crate::exitcode::{CuError, CuResult};
use std::io::BufRead;
use std::sync::atomic::AtomicU8;
use std::sync::OnceLock;

/// Bit 0: izquierdo, 1: derecho.
pub static HELD_BUTTONS: AtomicU8 = AtomicU8::new(0);
/// Bit 0: ctrl, 1: alt, 2: shift, 3: win.
pub static HELD_MODS: AtomicU8 = AtomicU8::new(0);
static STOP_FILE: OnceLock<String> = OnceLock::new();

pub fn set_stop_file(path: String) {
    let _ = STOP_FILE.set(path);
}

/// Punto de control en cada paso de una animación o de un tecleo.
pub fn checkpoint() -> CuResult<()> {
    if let Some(p) = STOP_FILE.get() {
        if !p.is_empty() && std::fs::metadata(p).is_ok() {
            return Err(CuError::stopped());
        }
    }
    Ok(())
}

/// Suelta lo que ESTE proceso mantiene pulsado.
pub fn release_ours() {
    input::release_tracked();
}

pub fn stop_now() -> ! {
    release_ours();
    eprintln!("Control detenido por el usuario");
    std::process::exit(crate::exitcode::STOPPED);
}

/// Hilo que lee stdin: `STOP` o EOF → parada inmediata.
pub fn spawn_stdin_watch() {
    std::thread::spawn(|| {
        let stdin = std::io::stdin();
        let mut line = String::new();
        loop {
            line.clear();
            match stdin.lock().read_line(&mut line) {
                Ok(0) | Err(_) => stop_now(),
                Ok(_) => {
                    if line.trim().eq_ignore_ascii_case("STOP") {
                        stop_now();
                    }
                }
            }
        }
    });
}
