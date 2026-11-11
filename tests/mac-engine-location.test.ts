import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type EngineStatus, ON_WINDOWS, choiceOf, engineDetail, engineOptions, movingText, valueOf } from '../packages/mac/src/dialogs/engine-location-model.js';

/**
 * Settings › Advanced › Engine on Windows: the engine on this PC or in a WSL distro
 * (packages/mac/src/dialogs/engine-location-model.ts). Starting it there, reading its port and
 * reaching it is the app shell's, tested in packages/mac/src-tauri/src/engine.rs.
 */

const windows: EngineStatus = { place: 'windows', distro: null, available: true, route: null };
const wsl: EngineStatus = { place: 'wsl', distro: 'Ubuntu-24.04', available: true, route: 'mirrored networking' };

describe('where Beluga runs', () => {
  it('is Windows unless a distro is chosen', () => {
    expect(valueOf(windows)).toBe(ON_WINDOWS);
    expect(valueOf({ place: 'wsl', distro: null })).toBe(ON_WINDOWS);
    expect(valueOf(wsl)).toBe('wsl:Ubuntu-24.04');
  });

  it('asks the shell for what was picked', () => {
    expect(choiceOf(ON_WINDOWS)).toEqual({ place: 'windows', distro: null });
    expect(choiceOf('wsl:Ubuntu-24.04')).toEqual({ place: 'wsl', distro: 'Ubuntu-24.04' });
    for (const st of [windows, wsl]) expect(choiceOf(valueOf(st))).toEqual({ place: st.place, distro: st.distro });
  });

  it('offers this PC first, then each distro', () => {
    expect(engineOptions(['Ubuntu-24.04', 'Debian'], windows)).toEqual([
      { value: 'windows', label: 'This PC (Windows)' },
      { value: 'wsl:Ubuntu-24.04', label: 'WSL · Ubuntu-24.04' },
      { value: 'wsl:Debian', label: 'WSL · Debian' },
    ]);
    // Without WSL, only this PC.
    expect(engineOptions([], windows)).toEqual([{ value: 'windows', label: 'This PC (Windows)' }]);
    // A distro chosen before still shows while WSL can't list it.
    expect(engineOptions([], wsl).map((o) => o.value)).toEqual(['windows', 'wsl:Ubuntu-24.04']);
  });

  it('says where it runs and how it is reached', () => {
    expect(engineDetail(windows)).toContain('on Windows');
    expect(engineDetail(wsl)).toContain('runs in Ubuntu-24.04, reached at 127.0.0.1 through mirrored networking');
    expect(engineDetail({ ...wsl, route: null })).not.toContain('reached');
    expect(movingText('wsl:Debian')).toBe('Starting Beluga in Debian…');
    expect(movingText(ON_WINDOWS)).toContain('Windows');
  });

  it('is shown only where the shell has WSL, at the top of Advanced', () => {
    const pane = readFileSync('packages/mac/src/dialogs/EngineLocationSettings.tsx', 'utf8');
    expect(pane).toContain('!st.available');
    expect(pane).toContain('inApp()');
    const settings = readFileSync('packages/mac/src/dialogs/Settings.tsx', 'utf8');
    expect(settings.indexOf('<EngineLocationSettings />')).toBeLessThan(settings.indexOf('<WebAccessSettings />'));
  });

  it('matches the commands the shell registers', () => {
    const lib = readFileSync('packages/mac/src-tauri/src/lib.rs', 'utf8');
    for (const cmd of ['engine_location', 'wsl_distros', 'set_engine_location']) expect(lib).toMatch(new RegExp(`^\\s+${cmd},$`, 'm'));
  });
});
