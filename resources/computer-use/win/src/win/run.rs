//! Ejecución de cada comando en Windows. Orden de las puertas (todas fallan cerrado):
//!  1. consentimiento + sesión interactiva + sin escritorio seguro + helper no elevado (código 12);
//!  2. monitor principal (11), ventana bajo el punto y en primer plano no bloqueada ni elevada (11);
//!  3. campo seguro (9) antes de teclear;
//!  4. política de teclas (11) antes de pulsar;
//!  5. rutas de salida dentro del directorio temporal (1).

use super::apps;
use super::capture;
use super::hook;
use super::input;
use super::process;
use super::screen;
use super::session;
use super::stop;
use super::uia::{frame_json, Uia};
use super::wnd::{self, AppCache};
use crate::appkey::AppKey;
use crate::cli::Output;
use crate::commands::{Command, Global};
use crate::exitcode::{self, CuError, CuResult};
use crate::json::Json;
use crate::keys::{check_keys, is_lazunox_exe, KeyPolicyContext, KeyRejection};
use crate::limits::*;
use crate::mask::{capture_size, fill_black, plan_masks, windows_changed, MaskPlan, Rect, WinInfo};
use crate::motion::{plan_type, Rng};
use crate::paths::{self, image_format};
use crate::roles::format_ref;
use std::time::Duration;

struct Env {
    consent: bool,
    temp_root: Option<String>,
    input_file: Option<String>,
    stop_shortcut: Option<String>,
}

fn env_var(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn read_env() -> Env {
    // %TEMP% puede venir en forma corta 8.3 (usuarios con nombre largo): se expande antes de validar.
    let root = env_var("CU_TEMP_DIR").or_else(|| env_var("TEMP")).or_else(|| env_var("TMP"));
    let root = root.map(|r| process::long_path(&r).unwrap_or(r));
    Env {
        consent: env_var("COMPUTER_WIN_CONSENT").as_deref() == Some("1"),
        temp_root: root,
        input_file: env_var("COMPUTER_INPUT_FILE"),
        stop_shortcut: env_var("CU_STOP_SHORTCUT"),
    }
}

impl Env {
    fn image_out(&self, raw: &str) -> CuResult<String> {
        let root = self.temp_root.as_deref().ok_or_else(|| CuError::generic("Sin directorio temporal (CU_TEMP_DIR/TEMP): no se escribe nada"))?;
        // El llamador puede traer el directorio en forma corta 8.3: se expande el directorio (que debe existir).
        let p0 = std::path::Path::new(raw);
        let name = p0.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| CuError::generic("Ruta de salida sin nombre de archivo"))?;
        let dir0 = p0.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
        let dir = process::long_path(&dir0).unwrap_or(dir0);
        let path = format!("{}\\{}", dir.trim_end_matches(['\\', '/']), name);
        let path = path.as_str();
        paths::validate_image_out(path, root).map_err(CuError::generic)?;
        // Contra enlaces y uniones: el directorio padre REAL debe seguir dentro de la raíz REAL.
        let p = std::path::Path::new(path);
        let parent = p.parent().ok_or_else(|| CuError::generic("Ruta de salida sin directorio"))?;
        let real_parent = std::fs::canonicalize(parent).map_err(|_| CuError::generic("El directorio de salida no existe"))?;
        let real_root = std::fs::canonicalize(root).map_err(|_| CuError::generic("El directorio temporal no existe"))?;
        let strip = |p: &std::path::Path| p.to_string_lossy().trim_start_matches("\\\\?\\").to_string();
        paths::validate_image_out(&format!("{}\\{}", strip(&real_parent), p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()), &strip(&real_root))
            .map_err(|_| CuError::generic("La ruta de salida sale del directorio temporal (enlace o unión)"))?;
        // Un archivo de destino que ya existe y es un enlace simbólico podría llevar la escritura fuera del temporal.
        if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(CuError::generic("La ruta de salida es un enlace simbólico"));
        }
        Ok(path.to_string())
    }
}

fn gate(env: &Env) -> CuResult<()> {
    session::require_control(env.consent)
}

fn ok() -> CuResult<Output> {
    Ok(Output::ok(Json::obj([("ok", Json::Bool(true))])))
}

fn arr(items: Vec<Json>) -> CuResult<Output> {
    Ok(Output::ok(Json::Arr(items)))
}

fn rect_json(r: Rect) -> Json {
    Json::obj([("x", Json::num(r.x)), ("y", Json::num(r.y)), ("width", Json::num(r.w)), ("height", Json::num(r.h))])
}

fn app_obj(i: &wnd::AppInfo) -> Json {
    Json::obj([("name", Json::str(&i.name)), ("bundleId", Json::str(&i.key)), ("pid", Json::num(i.pid))])
}

/// App sin identificar: el MCP la trata como desconocida y rechaza la acción (falla cerrado).
fn unidentified() -> Json {
    Json::obj([("name", Json::str("")), ("bundleId", Json::str("")), ("pid", Json::num(0))])
}

fn uia() -> CuResult<Uia> {
    Uia::new()
}

/// Elemento FRESCO de `path` dentro de la app (o 7/11/8).
fn element(app: &AppKey, path: &[usize], cache: &mut AppCache) -> CuResult<(Uia, windows::Win32::UI::Accessibility::IUIAutomationElement)> {
    let target = apps::resolve(cache, app)?;
    let u = uia()?;
    let roots = u.roots(&target.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>());
    let el = u
        .resolve(&roots, path)
        .ok_or_else(|| CuError::new(exitcode::ELEMENT_CHANGED, format!("El elemento cambió o no existe: {}", format_ref(path))))?;
    Ok((u, el))
}

fn key_reject(r: crate::keys::KeyReject) -> CuError {
    match r.code {
        KeyRejection::Invalid => CuError::generic(r.reason),
        _ => CuError::not_allowed(r.reason),
    }
}

pub fn run(g: &Global, cmd: &Command) -> CuResult<Output> {
    screen::set_dpi_awareness();
    let env = read_env();
    let mut cache = AppCache::default();
    // Caché del editor de cada ejecutable, SOLO dentro del directorio temporal ya validado.
    if let Some(root) = env.temp_root.as_deref() {
        let file = format!("{}\\{}", root.trim_end_matches(['\\', '/']), crate::pubcache::FILE_NAME);
        if paths::validate_data_file(&file, root).is_ok() && std::fs::symlink_metadata(&file).map(|m| !m.file_type().is_symlink()).unwrap_or(true) {
            cache.attach_disk_cache(file);
        }
    }
    // Los comandos de entrada solo necesitan saber si la ventana está bloqueada (ruta/integridad), no el editor.
    if cmd.is_input() || matches!(cmd, Command::Session) {
        cache.set_interest(&[]);
    }
    let r = run_inner(g, cmd, &env, &mut cache);
    cache.flush();
    r
}

fn run_inner(g: &Global, cmd: &Command, env: &Env, cache: &mut AppCache) -> CuResult<Output> {
    if let Some(sf) = env_var("COMPUTER_STOP_FILE") {
        stop::set_stop_file(sf);
    }
    // Contrato: todo comando escucha `STOP`/EOF por stdin (salida 3). Excepciones: `release-input` (debe terminar su
    // trabajo, es lo que se ejecuta tras un kill) y `watch-esc` (STOP → 3; EOF → sale en silencio: su dueño murió).
    match cmd {
        Command::ReleaseInput => {}
        Command::WatchEsc => stop::spawn_stdin_owner_watch(),
        _ => stop::spawn_stdin_watch(true),
    }
    if cmd.is_input() {
        // Reloj de 1 ms: sin esto, `sleep` redondea a ~15 ms y la animación a 120 Hz sale a saltos.
        unsafe {
            windows::Win32::Media::timeBeginPeriod(1);
        }
    }
    if cmd.needs_control() {
        gate(env)?;
    }
    let mut rng = Rng::from_clock();
    match cmd {
        Command::Move { x, y } => {
            let (xi, yi) = screen::require_on_monitor(*x, *y)?;
            apps::require_point_controllable(cache, xi, yi)?;
            apps::require_foreground_controllable(cache)?;
            input::glide(xi, yi, g.instant, &mut rng)?;
            ok()
        }
        Command::Click { x, y, right, count } => {
            let (xi, yi) = screen::require_on_monitor(*x, *y)?;
            apps::require_point_controllable(cache, xi, yi)?;
            apps::require_foreground_controllable(cache)?;
            input::click(xi, yi, *right, *count, g.instant, &mut rng)?;
            ok()
        }
        Command::Drag { x1, y1, x2, y2 } => {
            let a = screen::require_on_monitor(*x1, *y1)?;
            let b = screen::require_on_monitor(*x2, *y2)?;
            apps::require_point_controllable(cache, a.0, a.1)?;
            apps::require_point_controllable(cache, b.0, b.1)?;
            apps::require_foreground_controllable(cache)?;
            input::drag(a, b, g.instant, &mut rng)?;
            ok()
        }
        Command::Scroll { x, y, dx, dy } => {
            let (xi, yi) = screen::require_on_monitor(*x, *y)?;
            apps::require_point_controllable(cache, xi, yi)?;
            apps::require_foreground_controllable(cache)?;
            input::scroll(xi, yi, *dx, *dy, g.instant, &mut rng)?;
            ok()
        }
        Command::Type { text } => {
            let plan = plan_type(text, g.char_delay_ms, g.instant, &mut rng).map_err(CuError::generic)?;
            apps::require_foreground_controllable(cache)?;
            if uia()?.focused_is_secure() {
                return Err(CuError::new(exitcode::SECURE_FIELD, "Campo seguro: no se puede teclear"));
            }
            input::type_text(&plan)?;
            ok()
        }
        Command::Key { combos } => {
            let lazunox = apps::frontmost(cache).is_some_and(|i| is_lazunox_exe(crate::appkey::exe_base_name(&i.exe)));
            let ctx = KeyPolicyContext { lazunox_frontmost: lazunox, stop_shortcut: env.stop_shortcut.clone() };
            let list = check_keys(combos, &ctx).map_err(key_reject)?;
            apps::require_foreground_controllable(cache)?;
            if uia()?.focused_is_secure() {
                return Err(CuError::new(exitcode::SECURE_FIELD, "Campo seguro: no se pulsan teclas"));
            }
            for c in list {
                input::press_combo(&c)?;
                super::util::sleep_ms(30.0);
            }
            ok()
        }
        Command::Cursor => {
            let (x, y) = input::cursor_pos();
            Ok(Output::ok(Json::obj([("x", Json::num(x)), ("y", Json::num(y))])))
        }
        Command::Screens => arr(
            screen::monitors()
                .iter()
                .map(|m| {
                    let r = m.rect;
                    Json::obj([
                        ("width", Json::num(r.w)),
                        ("height", Json::num(r.h)),
                        ("scale", Json::num(m.scale())),
                        ("dpiScale", Json::num(m.scale())),
                        ("x", Json::num(r.x)),
                        ("y", Json::num(r.y)),
                        ("main", Json::Bool(m.main)),
                        (
                            "bounds",
                            Json::obj([
                                ("left", Json::num(r.x)),
                                ("top", Json::num(r.y)),
                                ("right", Json::num(r.right() as f64)),
                                ("bottom", Json::num(r.bottom() as f64)),
                            ]),
                        ),
                    ])
                })
                .collect(),
        ),
        Command::Permissions => {
            let s = session::state();
            let mons = screen::monitors();
            Ok(Output::ok(Json::obj([
                ("consent", Json::Bool(env.consent)),
                ("interactive", Json::Bool(s.interactive && !s.secure_desktop)),
                ("elevated", Json::Bool(process::self_elevated())),
                ("helper", Json::Bool(true)),
                ("dpi", Json::num(mons.iter().find(|m| m.main).map(|m| m.dpi).unwrap_or(96))),
                ("monitors", Json::num(mons.len() as f64)),
            ])))
        }
        Command::Frontmost => Ok(Output::ok(apps::frontmost(cache).map(|i| app_obj(&i)).unwrap_or_else(unidentified))),
        Command::AppAt { x, y } => {
            let list = wnd::enum_top(false).map_err(CuError::unavailable)?;
            let info = wnd::top_window_at(&list, x.round() as i32, y.round() as i32).and_then(|w| cache.info_for_window(w));
            Ok(Output::ok(info.map(|i| app_obj(&i)).unwrap_or_else(unidentified)))
        }
        Command::RunningApps => arr(apps::list(cache)?.iter().map(app_obj).collect()),
        Command::ListApps => arr(apps::list(cache)?
            .iter()
            // Toda entrada lleva un appKey válido (canónico). Una ventana cuya clave no se puede construir ya cuenta como
            // bloqueada y `screenshot` la tapa siempre, así que no hace falta listarla.
            .filter(|i| crate::appkey::parse_app_key(&i.key).is_ok())
            .map(|i| Json::obj([("name", Json::str(&i.name)), ("appKey", Json::str(&i.key)), ("pid", Json::num(i.pid))]))
            .collect()),
        Command::ResolveApp { query } => {
            let found = apps::resolve_by_name(cache, query)?.filter(|i| crate::appkey::parse_app_key(&i.key).is_ok());
            Ok(Output::ok(match found {
                Some(i) => Json::obj([("name", Json::str(&i.name)), ("bundleId", Json::str(&i.key)), ("appKey", Json::str(&i.key)), ("found", Json::Bool(true))]),
                None => Json::obj([("name", Json::str(query)), ("bundleId", Json::str("")), ("found", Json::Bool(false))]),
            }))
        }
        Command::Version => Ok(crate::cli::version_output()),
        Command::WindowsOf { keys } => arr(apps::windows_of(cache, keys)?.into_iter().map(rect_json).collect()),
        Command::FocusedSecure => Ok(Output::ok(Json::obj([("secure", Json::Bool(uia()?.focused_is_secure()))]))),
        Command::RecentInput => {
            let secs = env
                .input_file
                .as_deref()
                .zip(env.temp_root.as_deref())
                .and_then(|(f, root)| paths::validate_data_file(f, root).ok().map(|_| f))
                .and_then(|f| std::fs::read_to_string(f).ok())
                .and_then(|t| t.trim().parse::<u64>().ok())
                .map(|ms| (super::util::now_ms().saturating_sub(ms)) as f64 / 1000.0)
                .unwrap_or(999_999.0);
            Ok(Output::ok(Json::obj([("keyDownSeconds", Json::num(secs))])))
        }
        Command::WatchEsc => {
            let file = env.input_file.as_deref().zip(env.temp_root.as_deref()).and_then(|(f, root)| paths::validate_data_file(f, root).ok().map(|_| f.to_string()));
            hook::watch_esc(file).map_err(CuError::unavailable)?;
            Ok(Output::stream())
        }
        Command::Activate { target } => {
            let (activated, has_window) = apps::activate(cache, target)?;
            Ok(Output::ok(Json::obj([("ok", Json::Bool(has_window)), ("activated", Json::Bool(activated)), ("hasWindow", Json::Bool(has_window))])))
        }
        Command::HideApps { keep } => {
            let hidden = apps::hide(cache, keep)?;
            Ok(Output::ok(Json::obj([("hidden", Json::Arr(hidden.iter().map(Json::str).collect()))])))
        }
        Command::UnhideApps { list } => {
            let shown = apps::unhide(cache, list)?;
            Ok(Output::ok(Json::obj([("unhidden", Json::Arr(shown.iter().map(Json::str).collect()))])))
        }
        Command::AxTree { app, max_depth, max_nodes } => {
            let target = apps::resolve(cache, app)?;
            let u = uia()?;
            let roots = u.roots(&target.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>());
            let (nodes, truncated) = u.tree(&roots, *max_depth, *max_nodes, Duration::from_millis(TREE_BUDGET_MS));
            Ok(Output::ok(Json::obj([("app", app_obj(&target.info)), ("nodes", Json::Arr(nodes)), ("truncated", Json::Bool(truncated))])))
        }
        Command::AxFind { app, query } => {
            let target = apps::resolve(cache, app)?;
            let u = uia()?;
            let roots = u.roots(&target.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>());
            let found = u.find(&roots, query, FIND_WALK_DEPTH, FIND_WALK_NODES, Duration::from_millis(TREE_BUDGET_MS));
            Ok(Output::ok(Json::obj([("matches", Json::Arr(found))])))
        }
        Command::AxFrame { app, path } => {
            let (u, el) = element(app, path, cache)?;
            Ok(Output::ok(Json::obj([("frame", frame_json(u.frame_of(&el)?))])))
        }
        Command::AxPress { app, path, expect_role, expect_title } => {
            let (u, el) = element(app, path, cache)?;
            u.expect(&el, expect_role, expect_title)?;
            u.press(&el)?;
            ok()
        }
        Command::AxSetValue { app, path, value } => {
            let (u, el) = element(app, path, cache)?;
            u.set_value(&el, value)?;
            ok()
        }
        Command::AxAction { app, path, action } => {
            let (u, el) = element(app, path, cache)?;
            u.action(&el, *action)?;
            ok()
        }
        Command::FindElements { app, roles, query } => {
            let target = apps::resolve(cache, app)?;
            let u = uia()?;
            let roots = u.roots(&target.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>());
            let (found, truncated) = u.find_elements(&roots, roles, query, FIND_EL_NODES, FIND_EL_MATCHES, Duration::from_millis(FIND_EL_BUDGET_MS));
            Ok(Output {
                json: Some(Json::Arr(found)),
                code: 0,
                note: truncated.then(|| "find-elements: límite de nodos/tiempo alcanzado (resultados parciales)".to_string()),
            })
        }
        Command::WindowShot { app, out, index, max_long, quality } => window_shot(env, cache, app, out, *index, *max_long, *quality),
        Command::Screenshot { out, max_long, quality, mask_keys } => screenshot(env, cache, out, *max_long, *quality, mask_keys),
        Command::ReleaseInput => {
            input::release_by_state();
            ok()
        }
        Command::Session => {
            let s = session::state();
            let elevated_target = apps::require_foreground_controllable(cache).is_err();
            let j = Json::obj([("interactive", Json::Bool(s.interactive)), ("secureDesktop", Json::Bool(s.secure_desktop)), ("elevatedTarget", Json::Bool(elevated_target))]);
            if !s.interactive || s.secure_desktop {
                let why = if s.secure_desktop { "Escritorio seguro activo (UAC, bloqueo o Ctrl+Alt+Supr)" } else { "Sin escritorio interactivo" };
                return Ok(Output { json: Some(j), code: exitcode::UNAVAILABLE, note: Some(why.into()) });
            }
            Ok(Output::ok(j))
        }
        Command::Deferred { name } => Err(CuError::unavailable(format!("{name}: no implementado en esta versión del helper de Windows (tanda posterior)"))),
        Command::Unavailable { name, reason } => Err(CuError::unavailable(format!("{name}: {reason}"))),
    }
}

fn window_shot(env: &Env, cache: &mut AppCache, app: &AppKey, out: &str, index: usize, max_long: i64, quality: i64) -> CuResult<Output> {
    let out = env.image_out(out)?;
    let target = apps::resolve(cache, app)?;
    let wins: Vec<_> = target.windows.iter().filter(|w| !w.iconic && w.rect.w > 0 && w.rect.h > 0).collect();
    let w = wins.get(index).ok_or_else(|| CuError::unavailable("La app no tiene esa ventana visible"))?;
    let img = capture::grab_window(w.hwnd, w.rect)?;
    let (tw, th, _) = capture_size(img.w as i64, img.h as i64, max_long).ok_or_else(|| CuError::unavailable("Ventana sin tamaño"))?;
    let res = capture::encode(&img, &out, image_format(&out), (tw, th), quality);
    if res.is_err() {
        let _ = std::fs::remove_file(&out);
    }
    res?;
    Ok(Output::ok(Json::obj([("ok", Json::Bool(true)), ("width", Json::num(tw)), ("height", Json::num(th)), ("title", Json::str(&w.title)),
        // Dónde está la ventana (coordenadas globales de pantalla) y qué rectángulo se pintó en la imagen: el MCP los usa para
        // convertir píxeles de la imagen en un punto de pantalla sin capturar la pantalla completa.
        ("x", Json::num(w.rect.x)),
        ("y", Json::num(w.rect.y)),
        ("srcWidth", Json::num(w.rect.w)),
        ("srcHeight", Json::num(w.rect.h)),
        (
            "frame",
            Json::obj([("x", Json::num(w.frame.x)), ("y", Json::num(w.frame.y)), ("width", Json::num(w.frame.w)), ("height", Json::num(w.frame.h))]),
        ),
    ])))
}

/// Foto de las ventanas visibles con su concesión, de delante hacia atrás. None si la enumeración falla.
fn snapshot(cache: &mut AppCache, mask_keys: &[String]) -> Option<Vec<WinInfo>> {
    let list = wnd::enum_top(false).ok()?;
    let mut out = Vec::with_capacity(list.len());
    for w in &list {
        if w.rect.w <= 0 || w.rect.h <= 0 {
            continue;
        }
        let info = cache.info_for_window(w);
        let granted = match &info {
            None => false,
            Some(i) if i.blocked() => false,
            // El shell (barra de tareas, escritorio) no se enmascara aunque explorer.exe esté en la lista.
            Some(_) if apps::is_shell_window(w) => true,
            Some(i) => !mask_keys.contains(&i.key),
        };
        out.push(WinInfo { id: w.hwnd.0 as usize as u64, rect: w.rect, cover: w.frame, granted, opaque: !w.layered_or_transparent() });
    }
    Some(out)
}

fn screenshot(env: &Env, cache: &mut AppCache, out: &str, max_long: i64, quality: i64, mask_keys: &[AppKey]) -> CuResult<Output> {
    let out = env.image_out(out)?;
    let keys: Vec<String> = mask_keys.iter().map(|k| k.to_key_string()).collect();
    cache.set_interest(mask_keys);
    let main = screen::primary().ok_or_else(|| CuError::unavailable("No se pudo determinar el monitor principal"))?;
    let bounds = main.rect;
    let mut attempt = 0;
    let (mut img, masked) = loop {
        let before = snapshot(cache, &keys);
        let masks_before = match plan_masks(before.as_deref(), bounds, true) {
            MaskPlan::Ok(m) => m,
            MaskPlan::Fail(why) => return Err(CuError::unavailable(why)),
        };
        let img = capture::grab_rect(bounds)?;
        let after = snapshot(cache, &keys);
        let masks_after = match plan_masks(after.as_deref(), bounds, true) {
            MaskPlan::Ok(m) => m,
            MaskPlan::Fail(why) => return Err(CuError::unavailable(why)),
        };
        // Carrera entre la enumeración y la captura: si las zonas a tapar cambiaron, se repite (o se rechaza).
        let steady = match (before.as_deref(), after.as_deref()) {
            (Some(b), Some(a)) => !windows_changed(b, a),
            _ => false,
        };
        if steady && masks_before == masks_after {
            // Las máscaras son del escritorio virtual: se pasan al origen del monitor capturado.
            let local: Vec<Rect> = masks_after.iter().map(|r| Rect::new(r.x - bounds.x, r.y - bounds.y, r.w, r.h)).collect();
            break (img, local);
        }
        attempt += 1;
        if attempt >= 3 {
            return Err(CuError::unavailable("El escritorio cambió durante la captura y no se pudo enmascarar con seguridad: sin captura"));
        }
    };
    let n = fill_black(&mut img.px, img.w, img.h, &masked);
    let (tw, th, ratio) = capture_size(img.w as i64, img.h as i64, max_long).ok_or_else(|| CuError::unavailable("Monitor sin tamaño"))?;
    let res = capture::encode(&img, &out, image_format(&out), (tw, th), quality);
    if res.is_err() {
        let _ = std::fs::remove_file(&out);
    }
    res?;
    Ok(Output::ok(Json::obj([("width", Json::num(tw)), ("height", Json::num(th)), ("ratio", Json::num(ratio)), ("masked", Json::num(n as f64))])))
}
