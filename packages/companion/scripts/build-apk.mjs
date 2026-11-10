#!/usr/bin/env node
// The release APKs (BLG-430): Beluga-<version>.apk and Beluga-Link.apk in dist/, both signed with
// Beluga's own key and checked against signing.json. The key is ~/.beluga-release/beluga-android.p12
// (or BELUGA_ANDROID_KEYSTORE), its password in the Keychain as "beluga-android-release" (or
// BELUGA_ANDROID_KEY_PASSWORD). An APK signed with any other key can't update installed phones.
//
//   npm run apk            prebuild (clean), gradle assembleRelease, check, copy to dist/
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const want = JSON.parse(fs.readFileSync(path.join(root, 'signing.json'), 'utf8')).sha256.toLowerCase();

const fail = (msg) => {
  console.error(`build-apk: ${msg}`);
  process.exit(1);
};

const windows = process.platform === 'win32';

// Windows keeps the password in Credential Manager instead of the Keychain, as a generic
// credential named beluga-android-release (`cmdkey /generic:beluga-android-release /user:beluga /pass`).
const CRED_READ_PS = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -TypeDefinition @"',
  'using System; using System.Runtime.InteropServices;',
  'public static class BelugaCred {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct C { public int Flags, Type; public string Target, Comment; public long Written; public int BlobSize; public IntPtr Blob; public int Persist, AttrCount; public IntPtr Attrs; public string Alias, User; }',
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string t, int type, int flags, out IntPtr c);',
  '  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr c);',
  '  public static string Read(string t) { IntPtr p; if (!CredReadW(t, 1, 0, out p)) return null; try { var c = (C)Marshal.PtrToStructure(p, typeof(C)); return Marshal.PtrToStringUni(c.Blob, c.BlobSize / 2); } finally { CredFree(p); } }',
  '}',
  '"@',
  "$p = [BelugaCred]::Read('beluga-android-release'); if ($p -eq $null) { exit 1 }; [Console]::Out.Write($p)",
].join('\n');

const savedPassword = () =>
  windows
    ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CRED_READ_PS], { encoding: 'utf8' })
    : execFileSync('security', ['find-generic-password', '-s', 'beluga-android-release', '-w'], { encoding: 'utf8' }).trim();

const keystore = process.env.BELUGA_ANDROID_KEYSTORE ?? path.join(home, '.beluga-release', 'beluga-android.p12');
if (!fs.existsSync(keystore)) fail(`no signing key at ${keystore}`);
let password = process.env.BELUGA_ANDROID_KEY_PASSWORD;
if (!password) {
  try {
    password = savedPassword();
  } catch {
    password = '';
  }
  if (!password) fail(`the key’s password isn’t in ${windows ? 'Credential Manager' : 'the Keychain'} (beluga-android-release)`);
}

const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
const sdk = process.env.ANDROID_HOME ?? (windows ? path.join(local, 'Android', 'Sdk') : path.join(home, 'Library', 'Android', 'sdk'));
// Android Studio's own JDK on Windows; Homebrew's on a Mac.
const java = windows ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr') : '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';
const env = {
  ...process.env,
  CI: '1',
  ANDROID_HOME: sdk,
  JAVA_HOME: process.env.JAVA_HOME ?? java,
  BELUGA_ANDROID_KEYSTORE: keystore,
  BELUGA_ANDROID_KEY_PASSWORD: password,
};

// npm, npx, gradlew and apksigner are .cmd/.bat files on Windows, which only a shell runs.
const run = (cmd, args, cwd = root) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: windows });
  if (r.status !== 0) fail(`${cmd} ${args[0] ?? ''} failed`);
};

run('npm', ['run', 'worklet:bundle']);
run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--clean']);
// Gradle reads local.properties as Java properties, where \ escapes: forward slashes work everywhere.
fs.writeFileSync(path.join(root, 'android', 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
run(windows ? 'gradlew.bat' : './gradlew', ['assembleRelease'], path.join(root, 'android'));

const tools = path.join(sdk, 'build-tools');
const latest = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const apksigner = path.join(tools, latest, windows ? 'apksigner.bat' : 'apksigner');
const signer = (apk) => {
  const out = execFileSync(windows ? `"${apksigner}"` : apksigner, ['verify', '--print-certs', windows ? `"${apk}"` : apk], { env, encoding: 'utf8', shell: windows });
  const hex = /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(out)?.[1];
  return hex?.match(/../g)?.join(':').toLowerCase();
};

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const outputs = [
  [path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), `Beluga-${app.version}.apk`],
  [path.join(root, 'modules', 'phone-control', 'addon', 'build', 'outputs', 'apk', 'release', 'phone-control-addon-release.apk'), 'Beluga-Link.apk'],
];
for (const [from, name] of outputs) {
  if (!fs.existsSync(from)) fail(`no ${from}`);
  const got = signer(from);
  if (got !== want) fail(`${name} is signed with ${got ?? 'nothing'}, not Beluga's key (${want})`);
  fs.copyFileSync(from, path.join(dist, name));
  console.log(`✓ dist/${name} · ${(fs.statSync(from).size / 1e6).toFixed(0)} MB · signed with Beluga's key`);
}
