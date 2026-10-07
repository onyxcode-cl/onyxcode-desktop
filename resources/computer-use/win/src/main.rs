//! cu-helper: ver `lib.rs`. Contrato: `resources/computer-use/protocol.json`.
use cu_helper::cli::{run_cli, Output};
use std::io::Write;

fn main() {
    // Un fallo interno nunca debe parecer éxito ni dejar un código arbitrario.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("cu-helper: error interno: {info}");
        std::process::exit(1);
    }));
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let r = run_cli(&argv, &env, exec);
    if let Some(line) = &r.stdout {
        let mut o = std::io::stdout().lock();
        let _ = writeln!(o, "{line}");
        let _ = o.flush();
    }
    if let Some(e) = &r.stderr {
        eprintln!("{e}");
    }
    std::process::exit(r.code);
}

#[cfg(windows)]
fn exec(g: &cu_helper::commands::Global, c: &cu_helper::commands::Command) -> cu_helper::exitcode::CuResult<Output> {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    cu_helper::win::run::run(g, c)
}

#[cfg(not(windows))]
fn exec(_: &cu_helper::commands::Global, _: &cu_helper::commands::Command) -> cu_helper::exitcode::CuResult<Output> {
    Err(cu_helper::cli::not_windows())
}
