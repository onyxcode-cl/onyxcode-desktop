//! Programas que NUNCA se controlan ni se capturan (plan C §3 «Bloqueadas siempre»). Lista cerrada y PURA, por
//! nombre de ejecutable (en minúsculas) o AUMID. Además, el helper rechaza cualquier proceso de integridad alta o
//! desconocida (ventanas elevadas): esta lista cubre lo que, aun siendo de integridad media, no debe tocarse.

use crate::appkey::{exe_base_name, AppKey};

pub const BLOCKED_EXES: [&str; 18] = [
    "consent.exe",
    "credentialuibroker.exe",
    "logonui.exe",
    "lockapp.exe",
    "winlogon.exe",
    "securityhealthui.exe",
    "sechealthui.exe",
    "mmc.exe",
    "regedit.exe",
    "taskmgr.exe",
    "1password.exe",
    "bitwarden.exe",
    "keepass.exe",
    "keepassxc.exe",
    "dashlane.exe",
    "lastpass.exe",
    "enpass.exe",
    "nordpass.exe",
];

/// Prefijos de AUMID bloqueados (en minúsculas).
pub const BLOCKED_AUMID_PREFIXES: [&str; 3] = ["microsoft.sechealthui", "microsoft.windows.securityhealth", "microsoft.windows.credentialui"];

pub fn exe_blocked(base_name: &str) -> bool {
    let b = base_name.to_lowercase();
    BLOCKED_EXES.contains(&b.as_str())
}

pub fn aumid_blocked(aumid: &str) -> bool {
    let a = aumid.to_lowercase();
    BLOCKED_AUMID_PREFIXES.iter().any(|p| a.starts_with(p))
}

pub fn key_blocked(key: &AppKey) -> bool {
    match key {
        AppKey::Aumid(id) => aumid_blocked(id),
        AppKey::Exe { path, .. } => exe_blocked(exe_base_name(path)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appkey::parse_app_key;

    #[test]
    fn bloqueadas_por_nombre_y_aumid() {
        for n in ["consent.exe", "CONSENT.EXE", "Taskmgr.exe", "KeePassXC.exe", "regedit.exe"] {
            assert!(exe_blocked(n), "{n}");
        }
        for n in ["notepad.exe", "chrome.exe", "consent.exe.exe", "xconsent.exe"] {
            assert!(!exe_blocked(n), "{n}");
        }
        assert!(aumid_blocked("Microsoft.SecHealthUI_8wekyb3d8bbwe!SecHealthUI"));
        assert!(!aumid_blocked("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"));
    }

    #[test]
    fn por_clave() {
        assert!(key_blocked(&parse_app_key("exe:c:\\windows\\system32\\consent.exe|pub:(sin firma)").unwrap()));
        assert!(key_blocked(&parse_app_key("aumid:microsoft.sechealthui_8wekyb3d8bbwe!sechealthui").unwrap()));
        assert!(!key_blocked(&parse_app_key("exe:c:\\windows\\notepad.exe|pub:(sin firma)").unwrap()));
    }

    #[test]
    fn lista_en_minusculas_y_sin_duplicados() {
        let mut v = BLOCKED_EXES.to_vec();
        assert!(v.iter().all(|s| *s == s.to_lowercase()));
        v.sort_unstable();
        v.dedup();
        assert_eq!(v.len(), BLOCKED_EXES.len());
    }
}
