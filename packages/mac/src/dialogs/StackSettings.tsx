import { useState } from 'react';
import type { Key } from '@beluga/shared/i18n/index.js';
import { type StackCheck, stackKey } from '@beluga/core/stack-store.js';
import { hhmm } from '@beluga/shared/clock.js';
import { Button, Dot } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { say, useT } from '../lib/i18n.js';
import { Group, Row, Switch } from './settings-controls.js';

/**
 * Settings › Stack (docs/stack.md): the services and tools your agents lean on as the daemon last
 * found them, how to fix what's down or missing, Check Now, and what Beluga does by itself.
 */
export function StackSettings() {
  const t = useT();
  const api = useApi();
  const stack = useApp((st) => st.stack);
  const repair = useApp((st) => st.prefs.stackRepair ?? true);
  const bootstrap = useApp((st) => st.prefs.stackBootstrap ?? true);
  const [error, setError] = useState<string>();
  const checking = stack.checking;
  const check = (): void => {
    setError(undefined);
    void api.stack.check().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const services = stack.checks.filter((c) => c.kind === 'service');
  const tools = stack.checks.filter((c) => c.kind === 'tool');
  return (
    <>
      <Group title={say('Your stack')}>
        <Row label={t('stack.settings.group')} detail={t('stack.settings.detail')}>
          <Button size="small" disabled={checking} onClick={check}>
            {checking ? t('stack.settings.checking') : t('stack.settings.checkNow')}
          </Button>
        </Row>
        <p>{stack.checkedAt ? t('stack.settings.lastChecked', { time: hhmm(stack.checkedAt) }) : t('stack.settings.never')}</p>
        {error ? <p role="alert">{error}</p> : null}
      </Group>
      {services.length ? (
        <Group title={say('Services')}>
          {services.map((c) => (
            <CheckRow key={c.id} check={c} t={t} />
          ))}
        </Group>
      ) : null}
      {tools.length ? (
        <Group title={say('Tools')}>
          {tools.map((c) => (
            <CheckRow key={c.id} check={c} t={t} />
          ))}
        </Group>
      ) : null}
      <Group title={say('Automatically')}>
        <Row label={say('Start services that are down')} detail={t('stack.settings.repairDetail')}>
          <Switch label={t('stack.settings.repair')} on={repair} onChange={(v) => void api.session.setPrefs({ stackRepair: v })} />
        </Row>
        <Row label={say('Set up new projects')} detail={t('stack.settings.bootstrapDetail')}>
          <Switch label={t('stack.settings.bootstrap')} on={bootstrap} onChange={(v) => void api.session.setPrefs({ stackBootstrap: v })} />
        </Row>
      </Group>
    </>
  );
}

/** One check: its name and what it's for, its state, and how to fix it when it isn't up. */
function CheckRow({ check, t }: { check: StackCheck; t: (key: Key, params?: Record<string, string | number>) => string }) {
  const k = stackKey(check.id);
  const state = check.state === 'up' ? t(check.kind === 'tool' ? 'stack.state.installed' : 'stack.state.up') : check.started ? t('stack.state.starting') : t(check.state === 'down' ? 'stack.state.down' : 'stack.state.missing');
  const what = t(`stack.what.${k}` as Key);
  const detail = check.state === 'up' ? what : `${what}. ${t(`stack.fix.${k}` as Key)}`;
  return (
    <Row label={t(`stack.name.${k}` as Key)} detail={detail}>
      <span>
        <Dot tone={check.state === 'up' ? 'ok' : check.started ? 'info' : check.state === 'down' ? 'error' : 'warn'} /> {state}
      </span>
    </Row>
  );
}
