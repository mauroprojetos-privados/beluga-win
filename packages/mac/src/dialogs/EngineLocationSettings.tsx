import { useEffect, useState } from 'react';
import { inApp } from '../lib/boot.js';
import { type EngineStatus, choiceOf, engineDetail, engineOptions, movingText, valueOf } from './engine-location-model.js';
import { Group, Row, Select } from './settings-controls.js';
import { say, useT } from '../lib/i18n.js';
import s from './settings.module.css';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Settings › Advanced › Engine (Windows only): run Beluga's engine on this PC (the default) or in
 * a WSL distro. Moving it is tried first and kept only when Beluga answers there; then the window
 * reconnects, and shows that engine's projects. When WSL, or Beluga inside it, is missing, it
 * says how to install it.
 */
export function EngineLocationSettings() {
  useT();
  const [status, setStatus] = useState<EngineStatus>();
  const [distros, setDistros] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    if (!inApp()) return;
    let alive = true;
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const st = await invoke<EngineStatus>('engine_location');
      if (!alive || !st.available) return;
      setStatus(st);
      invoke<string[]>('wsl_distros').then(
        (list) => alive && setDistros(list),
        (err: unknown) => alive && setError(errorText(err)),
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!status) return null;
  const choose = async (value: string): Promise<void> => {
    if (value === valueOf(status)) return;
    setBusy(movingText(value));
    setError(undefined);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<EngineStatus>('set_engine_location', choiceOf(value));
      // The window connects again from the start, to the engine where it runs now.
      location.reload();
    } catch (err) {
      setError(errorText(err));
      setBusy(undefined);
    }
  };
  return (
    <Group title={say('Engine')}>
      <Row label={say('Where Beluga runs')} detail={engineDetail(status)}>
        <Select label={say('Where Beluga runs')} value={valueOf(status)} options={engineOptions(distros, status)} disabled={!!busy} onChange={(v) => void choose(v)} />
      </Row>
      {busy ? <div className={s.webBusy}>{busy}</div> : null}
      {error ? <div className={s.engineError}>{error}</div> : null}
    </Group>
  );
}
