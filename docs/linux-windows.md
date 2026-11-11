# Beluga on Linux and Windows

The same Beluga runs on Linux and Windows. Some things stay Mac only.

## What's different there

| | macOS | Linux | Windows |
|---|---|---|---|
| Main shortcut key | ⌘ | Ctrl | Ctrl |
| Keys shown as | ⇧⌘F | Ctrl+Shift+F | Ctrl+Shift+F |
| Copy and paste in the terminal | ⌘C / ⌘V | Ctrl+Shift+C / V | Ctrl+Shift+C / V |
| Shell for setup and run commands | your shell | your shell | Git Bash (Git for Windows), the shell Claude Code uses too |
| A friend's screenshot | screen or one app's window | whole screen (grim, gnome-screenshot, spectacle, scrot or ImageMagick) | screen or one app's window |
| Device info | sw_vers, system_profiler, pmset | os-release, /sys | PowerShell (CIM) |
| Keeping awake for the phone | caffeinate | systemd-inhibit | SetThreadExecutionState |
| Moving to the Trash | Finder / trash | gio trash | Recycle Bin |
| Window | blur, traffic lights | solid, the desktop's own title bar | solid, the system title bar |
| Packages | .dmg | AppImage (updates itself), .deb, .rpm | installer (updates itself) |
| What's new, on the app's icon | Dock badge | the desktop's own (when it shows one) | a count over the taskbar button |
| `beluga service install` | launchd agent, at login | systemd user service, from boot with lingering | Task Scheduler task, at sign-in |
| Where the engine runs | this Mac | this computer | this PC, or a WSL distro (Settings › Advanced › Engine) |

Mac only: desktop widgets, Focus, the macOS permission steps in the welcome, sleeping only after
the outbox is mailed (BLG-277), and notification sounds played from files (on Linux and Windows
the window plays them).

On Windows, `beluga service install` registers a task named "Beluga" for you (no admin, no saved
password): at sign-in it runs a hidden PowerShell script in `%LOCALAPPDATA%\Beluga\service` that
keeps `beluga up --foreground` going, starting it again 5 seconds after a failure and leaving it
stopped after `beluga stop`. It runs while you're signed in; for a PC that restarts by itself,
turn on automatic sign-in. `beluga service remove` stops it and deletes the task.

## The engine in WSL

Settings › Advanced › Engine (Windows only) picks where Beluga's engine runs: **This PC
(Windows)**, the default, or a WSL distro from `wsl.exe -l -q`, the way VS Code's Remote-WSL runs
its server in Linux. Then your projects, terminals, git and Claude are the distro's.

- The app runs a small script in the distro (`wsl.exe -d <distro> -e sh -s`) with your login
  shell's PATH: `beluga up` (it starts the engine kept alive, or finds the one that runs), then it
  reads the port and token from that engine's `${BELUGA_HOME:-~/.beluga}/daemon.json`. Without the
  `beluga` command (a checkout run as `node dist/cli.js up`), an engine that already runs there is
  used as it is.
- It connects to `127.0.0.1:<port>`. The engine listens on the distro's 127.0.0.1 only, so the
  distro's own IP never reaches it: with `networkingMode=mirrored` under `[wsl2]` in
  `%UserProfile%\.wslconfig` that address is this PC's; with NAT networking (WSL's default), WSL's
  localhost forwarding carries it. The setting says which one it used. With NAT and
  `localhostForwarding=false`, or when the port doesn't answer, it says to turn mirrored on. No
  SSH, P2P or Cloudflare relay.
- Moving to WSL is tried first and kept only when Beluga answers there; then the engine the app
  started on Windows stops and the window reconnects to the distro's. Back to Windows, the bundled
  engine starts again; the distro's keeps running until WSL shuts the distro down. While the app
  runs in WSL mode it keeps one `wsl.exe -d <distro> -e sleep infinity` open, so WSL doesn't shut
  the distro (and the engine) down under you.
- WSL missing, or no Linux in it: it says to run `wsl --install -d Ubuntu`. Beluga missing in the
  distro: it gives the install line (`curl -fsSL …/install.sh | sh`).
- Joining a friend's room from a link restarts the engine, which the app does only on Windows; in
  WSL it says to run `beluga join <link>` in the distro.
- The choice is kept in the app's config folder (`engine.json`). The code:
  `packages/mac/src-tauri/src/engine.rs` and `packages/mac/src/dialogs/EngineLocationSettings.tsx`.

## Developing on Windows

- Turn on **Developer Mode** (Settings › System › For developers) so Git and the tests can make
  symbolic links. Without it, about a hundred tests fail with `EPERM ... symlink`.
- Check the repository out with LF endings (`git config core.autocrlf input` before cloning, or
  `git clone -c core.autocrlf=input`). With `true`, tests that read fixtures back see `\r\n`.
- A few tests format money with the system's locale; run them with `LANG=en_US.UTF-8` on a PC
  set to another language.
- The Rust shell needs Rust (MSVC) and the Visual Studio C++ Build Tools; the app needs WebView2
  (already on Windows 11).
- The phone app's APKs build here too (`npm run apk` in `packages/companion`): the key's password
  is in Credential Manager as the generic credential `beluga-android-release`
  (`cmdkey /generic:beluga-android-release /user:beluga /pass`), the SDK in
  `%LOCALAPPDATA%\Android\Sdk`, and Java is Android Studio's own (`JAVA_HOME` overrides either).

Shortcuts that use ⌃ on a Mac have their own keys elsewhere: Toggle Sidebar is Ctrl+B,
Approve / Decline / Always Allow are Alt+Shift+Y / N / A, Move Project is Alt+Shift+↑/↓, and
Archive has no key (it's in the menu and ⌘K).

## Where the platform code lives

- The daemon branches by `process.platform` where the systems differ, behind the ports that
  already existed (SystemPort in `src/core/gateway/device.ts`, `Awake`'s platform option), so
  tests fake Linux and Windows on any machine (`pretendSystem({ platform })`).
- `src/core/process-tree.ts` stops a command together with everything it started: a process
  group on Mac and Linux, `taskkill /T` on Windows (where `detached` would open a console).
- `src/terminal/pty.ts`: `defaultShell` and `posixSh` for each system.
- The shortcut table (`packages/mac/src/lib/shortcuts-model.ts`) reads "Cmd" as the main
  modifier, as Tauri's CmdOrCtrl does. `keyPlatform()` says which keyboard it is.
- The Tauri shell gates Mac-only code with `cfg(target_os = "macos")`.
  `tauri.linux.conf.json` and `tauri.windows.conf.json` set the window and the bundles.

## Checks and releases

- `ci.yml` runs the tests on Ubuntu, macOS and Windows. Windows doesn't block a merge until it
  has passed once.
- `desktop.yml` builds the Rust shell with clippy and runs its tests on Linux and Windows.
- `release-desktop.yml` runs when a `-mac` release is published (or by hand for a tag). It
  builds the Linux and Windows packages, uploads them to the same release, and adds
  `linux-x86_64` and `windows-x86_64` to its `latest.json`. `release-mac.mjs` keeps those
  entries when it uploads again.
- The repository needs the `TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) secrets for update
  signatures.
- Windows code signing: put a code-signing certificate in the `WINDOWS_CERTIFICATE` secret (the
  `.pfx`, base64) and its password in `WINDOWS_CERTIFICATE_PASSWORD`. `release-desktop.yml` then
  imports it for the run and Tauri signs the app and the installer (SHA-256, DigiCert's
  timestamp). Without them the installer stays unsigned and SmartScreen warns on the first install.
