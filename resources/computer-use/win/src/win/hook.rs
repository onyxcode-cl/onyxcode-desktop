//! `watch-esc`: gancho WH_KEYBOARD_LL de SOLO ESCUCHA, vivo únicamente mientras hay control.
//!  - Esc real (no nuestro: `dwExtraInfo == TAG`) sin modificadores → una línea `STOP` por stdout.
//!  - Cualquier tecla real → anota la hora en `COMPUTER_INPUT_FILE` (para `recent-input`).
//!
//! NO guarda teclas: solo la hora y el hecho de que fue Esc. Un evento inyectado por terceros cuenta como del usuario.

use super::input::TAG;
use super::util::now_ms;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN,
    WM_SYSKEYDOWN,
};

static LAST_REAL_KEYDOWN: AtomicU64 = AtomicU64::new(0);
static ESC_PENDING: AtomicBool = AtomicBool::new(false);

fn mod_down(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 }
}

unsafe extern "system" fn proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == 0 && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN) {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if kb.dwExtraInfo != TAG {
            LAST_REAL_KEYDOWN.store(now_ms(), Ordering::SeqCst);
            if kb.vkCode == 0x1B && !(mod_down(0x10) || mod_down(0x11) || mod_down(0x12) || mod_down(0x5B) || mod_down(0x5C)) {
                ESC_PENDING.store(true, Ordering::SeqCst);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Bloquea hasta que el proceso termine (lo para el hilo de stdin: STOP/EOF → salida 3, o el llamador lo mata).
pub fn watch_esc(input_file: Option<String>) -> Result<(), String> {
    unsafe {
        let module = GetModuleHandleW(None).map_err(|e| format!("GetModuleHandle: {e}"))?;
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc), Some(module.into()), 0).map_err(|e| format!("No se pudo instalar el gancho de teclado: {e}"))?;
    }
    // El gancho debe ser rápido: la salida y el archivo los atiende otro hilo.
    std::thread::spawn(move || {
        let mut last_written = 0u64;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(10));
            if ESC_PENDING.swap(false, Ordering::SeqCst) {
                let mut o = std::io::stdout().lock();
                let _ = o.write_all(b"STOP\n");
                let _ = o.flush();
            }
            let t = LAST_REAL_KEYDOWN.load(Ordering::SeqCst);
            if t != last_written {
                if let Some(p) = &input_file {
                    let _ = std::fs::write(p, t.to_string());
                }
                last_written = t;
            }
        }
    });
    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}
