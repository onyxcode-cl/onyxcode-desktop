//! Ratón y teclado reales con SendInput. Todos los eventos llevan la marca `TAG` en `dwExtraInfo` para que `watch-esc`
//! distinga los propios de los del usuario. Sin hilos propios ni temporizadores ocultos: lo que se pulsa se suelta.

use super::stop::{checkpoint, HELD_BUTTONS, HELD_MODS};
use super::util::sleep_ms;
use crate::exitcode::{CuError, CuResult};
use crate::keys::{key_vk, mod_vk};
use crate::keys::{VK_RETURN, VK_TAB};
use crate::motion::{glide_path, paced_delay, wheel_deltas, PlannedStep, Rng, TypeStep};
use std::sync::atomic::Ordering;
use std::time::Instant;
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SetCursorPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// «LAZUNOX» truncado: el mismo valor que usa el helper de macOS.
pub const TAG: usize = 0x4C41_5049;

const MOD_NAMES: [&str; 4] = ["ctrl", "alt", "shift", "win"];

fn send(inputs: &[INPUT]) -> CuResult<()> {
    let n = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    if n as usize != inputs.len() {
        return Err(CuError::generic("No se pudo enviar la entrada (¿bloqueada por otra ventana o por la sesión?)"));
    }
    Ok(())
}

fn mouse(dx: i32, dy: i32, data: u32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: TAG } },
    }
}

fn key_event(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: TAG } },
    }
}

pub fn cursor_pos() -> (i32, i32) {
    let mut p = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut p);
    }
    (p.x, p.y)
}

fn move_abs(x: i32, y: i32) -> CuResult<()> {
    let (vx, vy, vw, vh) = unsafe {
        (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN).max(2), GetSystemMetrics(SM_CYVIRTUALSCREEN).max(2))
    };
    let nx = (((x - vx) as i64 * 65535 + (vw as i64 - 1) / 2) / (vw as i64 - 1)).clamp(0, 65535) as i32;
    let ny = (((y - vy) as i64 * 65535 + (vh as i64 - 1) / 2) / (vh as i64 - 1)).clamp(0, 65535) as i32;
    send(&[mouse(nx, ny, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)])
}

/// Lleva el cursor a `(x, y)` por una curva suave (o de golpe con `instant`). El último paso es exacto.
pub fn glide(x: i32, y: i32, instant: bool, rng: &mut Rng) -> CuResult<()> {
    let (cx, cy) = cursor_pos();
    let path = glide_path((cx as f64, cy as f64), (x as f64, y as f64), instant, rng);
    let start = Instant::now();
    for wp in &path {
        checkpoint()?;
        move_abs(wp.x, wp.y)?;
        let due = wp.at_ms - start.elapsed().as_secs_f64() * 1000.0;
        if due > 0.0 {
            sleep_ms(due);
        }
    }
    unsafe {
        let _ = SetCursorPos(x, y);
    }
    Ok(())
}

fn button_flags(right: bool) -> (MOUSE_EVENT_FLAGS, MOUSE_EVENT_FLAGS, u8) {
    if right {
        (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, 2)
    } else {
        (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, 1)
    }
}

fn button_down(right: bool) -> CuResult<()> {
    let (d, _, bit) = button_flags(right);
    send(&[mouse(0, 0, 0, d)])?;
    HELD_BUTTONS.fetch_or(bit, Ordering::SeqCst);
    Ok(())
}

fn button_up(right: bool) -> CuResult<()> {
    let (_, u, bit) = button_flags(right);
    let r = send(&[mouse(0, 0, 0, u)]);
    HELD_BUTTONS.fetch_and(!bit, Ordering::SeqCst);
    r
}

pub fn click(x: i32, y: i32, right: bool, count: u8, instant: bool, rng: &mut Rng) -> CuResult<()> {
    glide(x, y, instant, rng)?;
    sleep_ms(if instant { 30.0 } else { rng.range(60.0, 110.0) });
    for i in 0..count {
        checkpoint()?;
        button_down(right)?;
        sleep_ms(if instant { 20.0 } else { rng.range(35.0, 75.0) });
        button_up(right)?;
        if i + 1 < count {
            sleep_ms(if instant { 40.0 } else { rng.range(60.0, 110.0) });
        }
    }
    Ok(())
}

pub fn drag(from: (i32, i32), to: (i32, i32), instant: bool, rng: &mut Rng) -> CuResult<()> {
    glide(from.0, from.1, instant, rng)?;
    sleep_ms(if instant { 30.0 } else { rng.range(80.0, 140.0) });
    button_down(false)?;
    sleep_ms(if instant { 30.0 } else { rng.range(80.0, 150.0) });
    let r = glide(to.0, to.1, instant, rng);
    if r.is_ok() {
        sleep_ms(if instant { 30.0 } else { rng.range(60.0, 120.0) });
    }
    // Sea cual sea el resultado, el botón se suelta.
    let up = button_up(false);
    r.and(up)
}

pub fn scroll(x: i32, y: i32, dx: f64, dy: f64, instant: bool, rng: &mut Rng) -> CuResult<()> {
    glide(x, y, instant, rng)?;
    sleep_ms(if instant { 20.0 } else { rng.range(40.0, 80.0) });
    let (h, v) = wheel_deltas(dx, dy);
    if v != 0 {
        send(&[mouse(0, 0, v as u32, MOUSEEVENTF_WHEEL)])?;
    }
    if h != 0 {
        send(&[mouse(0, 0, h as u32, MOUSEEVENTF_HWHEEL)])?;
    }
    Ok(())
}

fn scan_of(vk: u16) -> u16 {
    unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as u16 }
}

fn key_tap(vk: u16, extended: bool) -> CuResult<()> {
    let ext = if extended { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) };
    let sc = scan_of(vk);
    send(&[key_event(vk, sc, ext)])?;
    send(&[key_event(vk, sc, ext | KEYEVENTF_KEYUP)])
}

fn unit_tap(unit: u16) -> CuResult<()> {
    send(&[key_event(0, unit, KEYEVENTF_UNICODE)])?;
    send(&[key_event(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)])
}

pub fn type_text(plan: &[PlannedStep]) -> CuResult<()> {
    for p in plan {
        checkpoint()?;
        match &p.step {
            TypeStep::Units(units) => {
                for u in units {
                    unit_tap(*u)?;
                }
            }
            TypeStep::Enter => key_tap(VK_RETURN, false)?,
            TypeStep::Tab => key_tap(VK_TAB, false)?,
        }
        sleep_ms(paced_delay(p.delay_ms));
    }
    Ok(())
}

fn mod_bit(m: &str) -> u8 {
    MOD_NAMES.iter().position(|n| *n == m).map(|i| 1u8 << i).unwrap_or(0)
}

fn mod_event(m: &str, up: bool) -> CuResult<()> {
    let vk = mod_vk(m).ok_or_else(|| CuError::generic("Modificador desconocido"))?;
    let mut f = if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) };
    if m == "win" {
        f |= KEYEVENTF_EXTENDEDKEY;
    }
    send(&[key_event(vk, scan_of(vk), f)])?;
    if up {
        HELD_MODS.fetch_and(!mod_bit(m), Ordering::SeqCst);
    } else {
        HELD_MODS.fetch_or(mod_bit(m), Ordering::SeqCst);
    }
    Ok(())
}

/// Pulsa una combinación YA validada por la política (`keys::check_keys`): `ctrl+shift+t`.
pub fn press_combo(combo: &str) -> CuResult<()> {
    let p = crate::keys::parse_combo(combo).ok_or_else(|| CuError::generic("Combinación no válida"))?;
    let result = (|| {
        for m in &p.mods {
            checkpoint()?;
            mod_event(m, false)?;
            sleep_ms(8.0);
        }
        if !p.key.is_empty() {
            let (vk, ext) = key_vk(&p.key).ok_or_else(|| CuError::generic("Tecla desconocida"))?;
            checkpoint()?;
            key_tap(vk, ext)?;
        } else {
            sleep_ms(20.0);
        }
        Ok(())
    })();
    // Los modificadores se sueltan SIEMPRE, en orden inverso, aunque la pulsación fallara o se parara.
    for m in p.mods.iter().rev() {
        let _ = mod_event(m, true);
    }
    result
}

/// Suelta lo que este proceso tiene pulsado (según lo que él mismo anotó).
pub fn release_tracked() {
    let b = HELD_BUTTONS.load(Ordering::SeqCst);
    if b & 1 != 0 {
        let _ = send(&[mouse(0, 0, 0, MOUSEEVENTF_LEFTUP)]);
    }
    if b & 2 != 0 {
        let _ = send(&[mouse(0, 0, 0, MOUSEEVENTF_RIGHTUP)]);
    }
    HELD_BUTTONS.store(0, Ordering::SeqCst);
    let m = HELD_MODS.load(Ordering::SeqCst);
    for name in MOD_NAMES.iter().rev() {
        if m & mod_bit(name) != 0 {
            let _ = mod_event(name, true);
        }
    }
    HELD_MODS.store(0, Ordering::SeqCst);
}

fn down(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 }
}

/// `release-input`: suelta botones del ratón y Ctrl/Mayús/Alt/Win si el sistema los da por pulsados. Se ejecuta SIEMPRE
/// tras matar el helper (TerminateProcess no deja soltar nada).
pub fn release_by_state() {
    let btns: [(i32, MOUSE_EVENT_FLAGS); 3] = [(0x01, MOUSEEVENTF_LEFTUP), (0x02, MOUSEEVENTF_RIGHTUP), (0x04, MOUSEEVENTF_MIDDLEUP)];
    for (vk, up) in btns {
        if down(vk) {
            let _ = send(&[mouse(0, 0, 0, up)]);
        }
    }
    // (código virtual, ¿extendida?) de cada modificador izquierdo y derecho.
    let mods: [(i32, bool); 8] = [(0xA2, false), (0xA3, true), (0xA0, false), (0xA1, false), (0xA4, false), (0xA5, true), (0x5B, true), (0x5C, true)];
    for (vk, ext) in mods {
        if down(vk) {
            let f = KEYEVENTF_KEYUP | if ext { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) };
            let _ = send(&[key_event(vk as u16, scan_of(vk as u16), f)]);
        }
    }
    HELD_BUTTONS.store(0, Ordering::SeqCst);
    HELD_MODS.store(0, Ordering::SeqCst);
}
