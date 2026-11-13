import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fromWindowsSide, localPath } from '../src/core/home-path.js';

const wsl = { WSL_DISTRO_NAME: 'Ubuntu-24.04', HOME: '/home/me' } as NodeJS.ProcessEnv;

describe('a folder the Windows app picked, for an engine in WSL', () => {
  it('reads this distro’s share as the Linux path', () => {
    expect(fromWindowsSide('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\projetos\\erp', wsl)).toBe('/home/me/projetos/erp');
    expect(fromWindowsSide('\\\\wsl$\\ubuntu-24.04\\home\\me\\app\\', wsl)).toBe('/home/me/app');
    expect(fromWindowsSide('//wsl.localhost/Ubuntu-24.04/home/me/app', wsl)).toBe('/home/me/app');
    expect(fromWindowsSide('\\\\wsl.localhost\\Ubuntu-24.04', wsl)).toBe('/');
  });

  it('reads a Windows drive through /mnt', () => {
    expect(fromWindowsSide('D:\\Projetos\\Beluga', wsl)).toBe('/mnt/d/Projetos/Beluga');
    expect(fromWindowsSide('C:/Users/me/code', wsl)).toBe('/mnt/c/Users/me/code');
    expect(fromWindowsSide('E:\\', wsl)).toBe('/mnt/e');
  });

  it('leaves another distro’s share, Linux paths, and everything outside WSL as they are', () => {
    expect(fromWindowsSide('\\\\wsl.localhost\\Debian\\home\\me', wsl)).toBe('\\\\wsl.localhost\\Debian\\home\\me');
    expect(fromWindowsSide('/home/me/app', wsl)).toBe('/home/me/app');
    expect(fromWindowsSide('D:\\Projetos', {} as NodeJS.ProcessEnv, false)).toBe('D:\\Projetos');
    expect(fromWindowsSide('\\\\wsl.localhost\\Ubuntu-24.04\\home', {} as NodeJS.ProcessEnv, false)).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\home');
  });

  it('reads the share in a systemd service too, where WSL_DISTRO_NAME isn’t set', () => {
    expect(fromWindowsSide('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\app', { HOME: '/home/me' } as NodeJS.ProcessEnv, true)).toBe('/home/me/app');
    expect(fromWindowsSide('D:\\x', { HOME: '/home/me' } as NodeJS.ProcessEnv, true)).toBe('/mnt/d/x');
  });

  it('still expands ~', () => {
    expect(localPath('~/app', wsl)).toBe(path.join('/home/me', 'app'));
  });
});
