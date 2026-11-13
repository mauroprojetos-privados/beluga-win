//! Where Beluga's engine runs on Windows: on Windows itself (the bundled one, the default), or
//! inside a WSL distro, the way VS Code's Remote-WSL runs its server there. Settings › Advanced ›
//! Engine picks it; the choice is kept in the app's own config folder (engine.json), read before
//! the engine starts.
//!
//! In WSL the app runs `beluga up` in the distro (it starts the engine kept alive, or finds the
//! one that runs), reads the port and token from that engine's daemon.json, and connects to
//! 127.0.0.1:<port>. The engine listens on the distro's 127.0.0.1 only, so the distro's own IP
//! would never reach it: with `networkingMode=mirrored` in .wslconfig that 127.0.0.1 is this PC's;
//! with NAT networking WSL's localhost forwarding carries it. No SSH, P2P or relay.
//!
//! Off Windows the engine always runs here, so most of this module (WSL's distros, its networking,
//! the choice file) has no caller there: allowed, so `clippy -D warnings` passes on Linux and macOS
//! while Windows still flags anything really left unused.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(windows)]
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use crate::daemon::{locked, Endpoint};

/// Where the engine runs.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    #[default]
    Windows,
    Wsl,
}

/// The choice as engine.json keeps it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct Choice {
    #[serde(default)]
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distro: Option<String>,
}

/// What Settings › Advanced › Engine shows.
#[derive(Serialize, Clone, Debug)]
pub struct Status {
    pub place: Place,
    pub distro: Option<String>,
    /// Only Windows has WSL; elsewhere the setting isn't shown.
    pub available: bool,
    /// How the app reached the WSL engine last time ("mirrored networking", say).
    pub route: Option<String>,
}

/// Plain words for when WSL itself isn't there (or has no Linux yet).
pub const NO_WSL: &str = "WSL isn't set up on this PC, or has no Linux yet. In PowerShell run \
`wsl --install -d Ubuntu`, restart Windows if it asks, open Ubuntu once to make your user, then \
come back and pick it here.";

/// Plain words for a distro without Beluga in it.
pub fn no_cli(distro: &str) -> String {
    format!(
        "Beluga isn't installed in {distro}. Open a {distro} terminal and run \
`curl -fsSL https://github.com/kayraucklnc/beluga/releases/latest/download/install.sh | sh`, \
then pick {distro} here again."
    )
}

/// A distro name as `wsl.exe -l -q` prints it: letters, digits and `-._`, starting with a letter
/// or digit (never read as a flag), nothing a shell reads.
pub fn valid_distro(name: &str) -> bool {
    name.len() <= 64
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._".contains(c))
}

/// The choice from engine.json's text: anything unreadable, or WSL without a usable distro, is
/// the default (Windows).
pub fn parse_choice(text: &str) -> Choice {
    let choice: Choice = serde_json::from_str(text).unwrap_or_default();
    match (&choice.place, choice.distro.as_deref()) {
        (Place::Wsl, Some(d)) if valid_distro(d) => choice,
        (Place::Wsl, _) => Choice::default(),
        (Place::Windows, _) => choice,
    }
}

fn choice_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("engine.json"))
}

pub fn read_choice(app: &AppHandle) -> Choice {
    choice_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .map(|t| parse_choice(&t))
        .unwrap_or_default()
}

pub fn write_choice(app: &AppHandle, choice: &Choice) -> Result<(), String> {
    let file = choice_file(app).ok_or("Couldn't find the app's settings folder.")?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't save the setting: {e}"))?;
    }
    let text = serde_json::to_string_pretty(choice).map_err(|e| e.to_string())?;
    std::fs::write(file, text).map_err(|e| format!("Couldn't save the setting: {e}"))
}

/// The WSL distro the engine runs in, when that's the choice (only ever on Windows).
pub fn wsl_distro(app: &AppHandle) -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let choice = read_choice(app);
    match choice.place {
        Place::Wsl => choice.distro,
        Place::Windows => None,
    }
}

pub fn status(app: &AppHandle) -> Status {
    let choice = read_choice(app);
    Status {
        place: choice.place,
        distro: choice.distro,
        available: cfg!(windows),
        route: last_route(),
    }
}

/// `wsl.exe -l -q`'s output: UTF-16 (as wsl.exe writes it to a pipe) or UTF-8 (with
/// WSL_UTF8=1), one distro per line. Docker Desktop's own distros aren't for Beluga.
pub fn parse_distros(bytes: &[u8]) -> Vec<String> {
    let utf16 = bytes.len() >= 2 && bytes.len().is_multiple_of(2) && bytes.chunks(2).any(|c| c[1] == 0);
    let text = if utf16 {
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.lines()
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0'))
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .filter(|l| valid_distro(l))
        .map(str::to_owned)
        .collect()
}

/// How Windows reaches a distro's 127.0.0.1, from .wslconfig.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Networking {
    /// `networkingMode=mirrored`: the distro shares this PC's 127.0.0.1.
    Mirrored,
    /// NAT (WSL's default): only WSL's localhost forwarding carries it, unless it's turned off.
    Nat { localhost_forwarding: bool },
}

impl Networking {
    /// In words, for the setting and the log.
    pub fn route(self) -> &'static str {
        match self {
            Networking::Mirrored => "mirrored networking",
            Networking::Nat { .. } => "WSL's localhost forwarding (NAT networking)",
        }
    }
}

/// .wslconfig's [wsl2] networkingMode and localhostForwarding (keys are case-insensitive).
pub fn networking(wslconfig: Option<&str>) -> Networking {
    let mut mirrored = false;
    let mut forwarding = true;
    let mut in_wsl2 = false;
    for line in wslconfig.unwrap_or("").lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') {
            in_wsl2 = line.eq_ignore_ascii_case("[wsl2]");
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !in_wsl2 {
            continue;
        }
        let value = value
            .split(['#', ';'])
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_ascii_lowercase();
        match key.trim().to_ascii_lowercase().as_str() {
            "networkingmode" => mirrored = value == "mirrored",
            "localhostforwarding" => forwarding = value != "false",
            _ => {}
        }
    }
    if mirrored {
        Networking::Mirrored
    } else {
        Networking::Nat {
            localhost_forwarding: forwarding,
        }
    }
}

/// What it says when Windows can't reach an engine that runs in the distro.
pub fn unreachable(distro: &str, port: u16, net: Networking) -> String {
    let what = format!("Beluga runs in {distro} (port {port}), but Windows can't reach it at 127.0.0.1:{port}.");
    match net {
        Networking::Mirrored => format!(
            "{what} .wslconfig asks for mirrored networking: run `wsl --shutdown` so it takes effect, then open Beluga again."
        ),
        Networking::Nat {
            localhost_forwarding: false,
        } => format!(
            "{what} .wslconfig turns localhostForwarding off. Put `networkingMode=mirrored` under [wsl2] in %UserProfile%\\.wslconfig, run `wsl --shutdown`, then open Beluga again."
        ),
        Networking::Nat { .. } => format!(
            "{what} WSL's localhost forwarding didn't carry it. Put `networkingMode=mirrored` under [wsl2] in %UserProfile%\\.wslconfig, run `wsl --shutdown`, then open Beluga again."
        ),
    }
}

const NO_CLI_MARK: &str = "__BELUGA_NO_CLI__";
const INFO_MARK: &str = "__BELUGA_INFO__";
const UP_MARK: &str = "__BELUGA_UP__";

/// What runs in the distro (fed to `sh -s`): your login shell's PATH (nvm, ~/.local/bin, npm's
/// global folder), then `beluga up` (starts the engine kept alive, or finds the one that runs),
/// then that engine's daemon.json. Without the `beluga` command (a checkout run as
/// `node dist/cli.js up`), an engine that already runs there is used as it is. Markers keep it
/// apart from what your shell's startup prints.
pub fn script() -> String {
    format!(
        r#"p=$("${{SHELL:-/bin/sh}}" -lic 'printf "__BELUGA_PATH__%s__BELUGA_PATH__" "$PATH"' </dev/null 2>/dev/null)
case $p in *__BELUGA_PATH__*__BELUGA_PATH__*) p=${{p#*__BELUGA_PATH__}}; p=${{p%%__BELUGA_PATH__*}}; PATH="$p:$PATH" ;; esac
export PATH
h=${{BELUGA_HOME:-$HOME/.beluga}}
if command -v beluga >/dev/null 2>&1; then
  out=$(beluga up 2>&1 </dev/null)
else
  pid=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$h/daemon.json" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then out="already running (started without the beluga command)"; else echo {NO_CLI_MARK}; exit 0; fi
fi
printf '{UP_MARK}%s{UP_MARK}\n' "$out"
if [ -f "$h/daemon.json" ]; then printf '{INFO_MARK}'; cat "$h/daemon.json"; printf '{INFO_MARK}\n'; fi
"#
    )
}

/// What the distro said.
#[derive(Debug, PartialEq, Eq)]
pub enum Reply {
    NoCli,
    Up { port: u16, token: String },
    Failed(String),
}

#[derive(Deserialize)]
struct WslInfo {
    port: u16,
    token: String,
}

fn between<'a>(text: &'a str, mark: &str) -> Option<&'a str> {
    let rest = &text[text.find(mark)? + mark.len()..];
    Some(&rest[..rest.find(mark)?])
}

pub fn parse_reply(stdout: &str) -> Reply {
    if stdout.contains(NO_CLI_MARK) {
        return Reply::NoCli;
    }
    if let Some(info) = between(stdout, INFO_MARK).and_then(|j| serde_json::from_str::<WslInfo>(j.trim()).ok()) {
        if info.port != 0 && !info.token.is_empty() {
            return Reply::Up {
                port: info.port,
                token: info.token,
            };
        }
    }
    let said = between(stdout, UP_MARK).unwrap_or(stdout).trim();
    let tail: String = said
        .chars()
        .rev()
        .take(1500)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    Reply::Failed(if tail.is_empty() {
        "it said nothing".into()
    } else {
        tail
    })
}

#[cfg(windows)]
static ROUTE: Mutex<Option<String>> = Mutex::new(None);

#[cfg(windows)]
fn last_route() -> Option<String> {
    locked(&ROUTE).clone()
}

#[cfg(not(windows))]
fn last_route() -> Option<String> {
    None
}

#[cfg(windows)]
fn wsl_command() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let root = std::env::var_os("SYSTEMROOT").unwrap_or_else(|| "C:\\Windows".into());
    let mut c = std::process::Command::new(PathBuf::from(root).join("System32").join("wsl.exe"));
    // No console window for it.
    c.creation_flags(0x0800_0000);
    c
}

/// The distros WSL has, or plain words on how to get one.
#[cfg(windows)]
pub async fn distros() -> Result<Vec<String>, String> {
    use std::process::Stdio;
    let out = tauri::async_runtime::spawn_blocking(|| {
        wsl_command()
            .args(["-l", "-q"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?;
    match out {
        Ok(out) if out.status.success() => {
            let list = parse_distros(&out.stdout);
            if list.is_empty() {
                Err(NO_WSL.into())
            } else {
                Ok(list)
            }
        }
        _ => Err(NO_WSL.into()),
    }
}

#[cfg(not(windows))]
pub async fn distros() -> Result<Vec<String>, String> {
    Err("WSL is only on Windows.".into())
}

/// A `wsl.exe` that sleeps in the distro while the app runs: WSL shuts a distro down a little
/// after its last session ends, and the engine with it.
#[cfg(windows)]
static KEEPER: Mutex<Option<(String, std::process::Child)>> = Mutex::new(None);

#[cfg(windows)]
fn keep_running(distro: &str) {
    use std::process::Stdio;
    let mut slot = locked(&KEEPER);
    if let Some((name, child)) = slot.as_mut() {
        if name == distro && matches!(child.try_wait(), Ok(None)) {
            return;
        }
    }
    if let Some((_, mut old)) = slot.take() {
        let _ = old.kill();
        let _ = old.wait();
    }
    if let Ok(child) = wsl_command()
        .args(["-d", distro, "-e", "sleep", "infinity"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        *slot = Some((distro.to_string(), child));
    }
}

/// Stop keeping a distro up (back to Windows, or quitting). The engine there stops when WSL
/// shuts the distro down, as one this app started stops when it quits.
#[cfg(windows)]
pub fn let_go() {
    if let Some((_, mut child)) = locked(&KEEPER).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *locked(&ROUTE) = None;
}

#[cfg(not(windows))]
pub fn let_go() {}

/// Run the script in the distro and read what it says.
#[cfg(windows)]
fn ask(distro: &str) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = wsl_command()
        .args(["-d", distro, "-e", "sh", "-s"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| NO_WSL.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(script().as_bytes())
            .map_err(|e| format!("Couldn't talk to {distro}: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Couldn't talk to {distro}: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Start (or find) Beluga in the distro and say where Windows reaches it.
#[cfg(windows)]
pub async fn ensure(distro: &str) -> Result<Endpoint, String> {
    use std::time::{Duration, Instant};
    if !valid_distro(distro) {
        return Err("That isn't a WSL distro's name.".into());
    }
    let name = distro.to_string();
    let said = tauri::async_runtime::spawn_blocking(move || ask(&name))
        .await
        .map_err(|e| e.to_string())??;
    let (port, token) = match parse_reply(&said) {
        Reply::NoCli => return Err(no_cli(distro)),
        Reply::Failed(why) => return Err(format!("Beluga in {distro} didn't start:\n{why}")),
        Reply::Up { port, token } => (port, token),
    };
    keep_running(distro);
    let wslconfig = dirs::home_dir()
        .and_then(|h| std::fs::read_to_string(h.join(".wslconfig")).ok());
    let net = networking(wslconfig.as_deref());
    if net == (Networking::Nat { localhost_forwarding: false }) {
        return Err(unreachable(distro, port, net));
    }
    // Forwarding a port can take a moment after the engine starts listening.
    let deadline = Instant::now() + Duration::from_secs(5);
    while !crate::daemon::listening(port) {
        if Instant::now() > deadline {
            return Err(unreachable(distro, port, net));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    eprintln!(
        "beluga: using the engine in WSL ({distro}) at 127.0.0.1:{port}, through {}",
        net.route()
    );
    *locked(&ROUTE) = Some(net.route().to_string());
    Ok(Endpoint {
        url: format!("ws://127.0.0.1:{port}"),
        token,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn reads_the_distros_wsl_lists() {
        let out = utf16("\u{feff}Ubuntu-24.04\r\ndocker-desktop\r\nDebian\r\n\r\n");
        assert_eq!(parse_distros(&out), ["Ubuntu-24.04", "Debian"]);
        // WSL_UTF8=1 makes it plain UTF-8.
        assert_eq!(parse_distros(b"Ubuntu\nkali-linux\n"), ["Ubuntu", "kali-linux"]);
        assert!(parse_distros(b"").is_empty());
        // Nothing a shell would read as more than a name.
        assert_eq!(parse_distros(&utf16("Ubuntu\r\nbad;name\r\n")), ["Ubuntu"]);
    }

    #[test]
    fn a_distro_name_is_plain() {
        assert!(valid_distro("Ubuntu-24.04"));
        assert!(valid_distro("openSUSE_Tumbleweed"));
        assert!(!valid_distro(""));
        assert!(!valid_distro("a b"));
        assert!(!valid_distro("x;rm -rf"));
        assert!(!valid_distro("--exec"));
    }

    #[test]
    fn the_choice_defaults_to_windows() {
        assert_eq!(parse_choice(""), Choice::default());
        assert_eq!(parse_choice("{"), Choice::default());
        assert_eq!(parse_choice(r#"{"place":"wsl"}"#), Choice::default());
        assert_eq!(parse_choice(r#"{"place":"wsl","distro":"a b"}"#), Choice::default());
        assert_eq!(
            parse_choice(r#"{"place":"wsl","distro":"Ubuntu"}"#),
            Choice {
                place: Place::Wsl,
                distro: Some("Ubuntu".into())
            }
        );
        let saved = serde_json::to_string(&Choice::default()).unwrap();
        assert_eq!(saved, r#"{"place":"windows"}"#);
    }

    #[test]
    fn reads_the_networking_mode() {
        let mirrored = "[wsl2]\nmemory=8GB\nnetworkingMode=mirrored\n";
        assert_eq!(networking(Some(mirrored)), Networking::Mirrored);
        assert_eq!(networking(Some("[WSL2]\r\nNetworkingMode = \"Mirrored\" # yes\r\n")), Networking::Mirrored);
        let nat = Networking::Nat { localhost_forwarding: true };
        assert_eq!(networking(None), nat);
        assert_eq!(networking(Some("[wsl2]\nnetworkingMode=NAT\n")), nat);
        // Only [wsl2] counts, and a comment is no setting.
        assert_eq!(networking(Some("[experimental]\nnetworkingMode=mirrored\n")), nat);
        assert_eq!(networking(Some("[wsl2]\n# networkingMode=mirrored\n")), nat);
        assert_eq!(
            networking(Some("[wsl2]\nlocalhostForwarding=false\n")),
            Networking::Nat { localhost_forwarding: false }
        );
        assert_eq!(Networking::Mirrored.route(), "mirrored networking");
    }

    #[test]
    fn says_what_the_distro_answered() {
        let shell_noise = "Welcome to Ubuntu\n";
        let ok = format!(
            "{shell_noise}{UP_MARK}Beluga is already running{UP_MARK}\n{INFO_MARK}{{\"pid\":7,\"port\":41234,\"token\":\"tok\",\"version\":\"0.6.2\"}}\n{INFO_MARK}\n"
        );
        assert_eq!(parse_reply(&ok), Reply::Up { port: 41234, token: "tok".into() });
        assert_eq!(parse_reply(&format!("{NO_CLI_MARK}\n")), Reply::NoCli);
        let failed = format!("{UP_MARK}Beluga didn't start: port in use{UP_MARK}\n");
        assert_eq!(parse_reply(&failed), Reply::Failed("Beluga didn't start: port in use".into()));
        assert_eq!(parse_reply(""), Reply::Failed("it said nothing".into()));
        // A daemon.json without a token isn't one to connect to.
        let half = format!("{UP_MARK}x{UP_MARK}{INFO_MARK}{{\"pid\":7,\"port\":1,\"token\":\"\"}}{INFO_MARK}");
        assert_eq!(parse_reply(&half), Reply::Failed("x".into()));
    }

    #[test]
    fn the_script_reads_the_engine_the_cli_started() {
        let s = script();
        assert!(s.contains("beluga up"));
        // Without the command, only an engine whose process is there.
        assert!(s.contains("kill -0 \"$pid\""));
        assert!(s.contains("${BELUGA_HOME:-$HOME/.beluga}"));
        assert!(s.contains("-lic"));
        assert!(!s.contains('\r'));
    }

    #[test]
    fn unreachable_says_what_to_change() {
        let nat = unreachable("Ubuntu", 5000, Networking::Nat { localhost_forwarding: true });
        assert!(nat.contains("127.0.0.1:5000") && nat.contains("networkingMode=mirrored"));
        let mirrored = unreachable("Ubuntu", 5000, Networking::Mirrored);
        assert!(mirrored.contains("wsl --shutdown"));
        assert!(no_cli("Ubuntu").contains("install.sh"));
    }
}
