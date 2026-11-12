// "~" and full paths the same way on a Mac, Linux and Windows. Windows has no $HOME (its home is
// USERPROFILE, which os.homedir() reads) and writes "~\Documents" and "C:\Users\me" too.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Your home folder: $HOME where it's set (a Mac, Linux, tests), else what the system says. */
export const homeDir = (env: NodeJS.ProcessEnv = process.env): string => env.HOME || os.homedir();

/** "~" alone, or followed by "/" (or "\" on Windows). */
const TILDE = /^~(?=$|[\\/])/;

/**
 * "~/x" and "~\x" with your home folder in front; any other path as it is. The same file the
 * tools then open (core/remote-work.ts expandPath): the rest is joined on, so "~\proj" is
 * home/proj on a Mac too, never a file named "me\proj" beside it (a check and its tool must agree).
 */
export const expandHome = (p: string, home: string = homeDir()): string => {
  if (p === '~') return home;
  return TILDE.test(p) ? path.join(home, p.slice(2)) : p;
};

let wslKernel: boolean | undefined;
/** Running in WSL: Linux whose kernel release names Microsoft (read once). */
export const inWsl = (): boolean => {
  if (wslKernel === undefined) {
    try {
      wslKernel = process.platform === 'linux' && /microsoft/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
    } catch {
      wslKernel = false;
    }
  }
  return wslKernel;
};

const SEPS = /[\\/]+/;
/** "\\wsl.localhost\<distro>\…" or "\\wsl$\<distro>\…" (either slash): how Windows writes a WSL distro's files. */
const WSL_SHARE = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;
/** "D:\…" or "D:/…", or the drive alone ("D:", "D:\"). */
const DRIVE = /^([A-Za-z]):(?:[\\/](.*))?$/;
const joinPosix = (root: string, rest: string | undefined): string => {
  const parts = (rest ?? '').split(SEPS).filter(Boolean);
  return parts.length ? `${root === '/' ? '' : root}/${parts.join('/')}` : root;
};

/**
 * In WSL, a path as the Windows app wrote it (its folder picker, a drop) → the path Linux uses:
 * "\\wsl.localhost\Ubuntu\home\me\app" (this distro) → "/home/me/app", and "D:\code\app" →
 * "/mnt/d/code/app" (WSL's default automount). Outside WSL, or another distro's share, as it is.
 */
export const fromWindowsSide = (p: string, env: NodeJS.ProcessEnv = process.env, wsl: boolean = inWsl()): string => {
  // A systemd service in WSL (`beluga service install`) has no WSL_DISTRO_NAME: the kernel says it's WSL.
  const distro = env.WSL_DISTRO_NAME;
  if (!distro && !wsl) return p;
  const share = WSL_SHARE.exec(p);
  if (share) return !distro || share[1]!.toLowerCase() === distro.toLowerCase() ? joinPosix('/', share[2]) : p;
  const drive = DRIVE.exec(p);
  if (drive) return joinPosix(`/mnt/${drive[1]!.toLowerCase()}`, drive[2]);
  return p;
};

/** A folder the user named, from any screen: "~" expanded, and in WSL a Windows-written path made Linux's. */
export const localPath = (p: string, env: NodeJS.ProcessEnv = process.env, wsl: boolean = inWsl()): string => expandHome(fromWindowsSide(p, env, wsl), env.HOME || os.homedir());

/** Starts with "~/" or "~\" (or is "~"). */
export const startsAtHome = (p: string): boolean => TILDE.test(p);

/**
 * A full path from a root on any system: "/…", "C:\…", "C:/…" or "\\server\…". Unlike
 * path.isAbsolute, the answer is the same on every computer (a Windows path is absolute on a Mac).
 */
export const isFullPath = (p: string): boolean => path.posix.isAbsolute(p) || /^[A-Za-z]:[\\/]|^\\\\/.test(p);
