import { useState } from 'react';
import type { Key } from '@beluga/shared/i18n/index.js';
import { type ChecklistItem, type ChecklistItemId, type ChecklistPlace, type StackCheck, checklistNumber, stackKey } from '@beluga/core/stack-store.js';
import { hhmm } from '@beluga/shared/clock.js';
import { Button, Dot } from '../components/ui.js';
import { useApi, useApp, useBeluga } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
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
      <ChecklistSection />
    </>
  );
}

/** The file of yours each Fix that asks first changes (and backs up). */
const ASKS_ABOUT: Partial<Record<ChecklistItemId, string>> = {
  rtkHook: '~/.claude/settings.json',
  gitnexusHooks: '~/.claude/settings.json',
  mcps: '~/.claude.json',
  claudeMd: '~/.claude/CLAUDE.md',
  belugaJson: 'beluga.json',
  agentTools: '.claude/agents/*.md',
  agentModels: '.claude/agents/*.md',
};

interface FixResult {
  readonly ok: boolean;
  readonly changed: readonly string[];
  readonly why?: string;
}

/**
 * Settings › Stack › Checklist (docs/stack.md › Checklist): ✓ ⚠ ✗ per item, this computer first and
 * then each project and worktree, with Fix where there's one. A Fix that changes a file of yours asks
 * first (the daemon keeps a backup); what's the project's own fixes itself, so its Fix only retries.
 */
function ChecklistSection() {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const list = useApp((st) => st.stack.checklist);
  const [busy, setBusy] = useState<string>();
  const toast = (text: string, level: 'success' | 'error'): void => void client.store.dispatch({ type: 'toast', text, level });
  const failed = (err: unknown): void => toast(err instanceof Error ? err.message : String(err), 'error');
  const run = (): void => void api.stack.checklist().catch(failed);
  const fix = (item: ChecklistItem, place?: ChecklistPlace): void => {
    const name = t(`stack.item.${item.id}` as Key);
    const key = `${place?.id ?? ''}:${item.id}`;
    const go = (): void => {
      setBusy(key);
      void api.stack
        .fix(item.id, place?.id)
        .then((r) => {
          const res = r as FixResult;
          if (!res.ok) toast(t('stack.checklist.notFixed', { name, why: res.why ?? '' }), 'error');
          else toast(res.changed.length ? t('stack.checklist.fixedFiles', { name, files: res.changed.join(', ') }) : t('stack.checklist.fixed', { name }), 'success');
        })
        .catch(failed)
        .finally(() => setBusy(undefined));
    };
    const what = ASKS_ABOUT[item.id];
    if (item.fix === 'ask' && what) openSheet({ kind: 'confirm', title: name, message: t('stack.checklist.ask', { what }), confirm: t('stack.checklist.fix'), run: go });
    else go();
  };
  return (
    <>
      <Group title={t('stack.checklist.group')}>
        <Row label={t('stack.checklist.group')} detail={t('stack.checklist.detail')}>
          <Button size="small" disabled={list?.checking} onClick={run}>
            {list?.checking ? t('stack.checklist.running') : t('stack.checklist.run')}
          </Button>
        </Row>
        <p>{list?.checkedAt ? t('stack.checklist.lastRun', { time: hhmm(list.checkedAt) }) : t('stack.checklist.never')}</p>
      </Group>
      {list?.machine.length ? (
        <Group title={t('stack.checklist.thisComputer')}>
          {list.machine.map((item) => (
            <ItemRow key={item.id} item={item} busy={busy === `:${item.id}`} onFix={() => fix(item)} t={t} />
          ))}
        </Group>
      ) : null}
      {list?.places.map((place) => (
        <Group key={place.id} title={place.name}>
          {place.items.map((item) => (
            <ItemRow key={item.id} item={item} busy={busy === `${place.id}:${item.id}`} onFix={() => fix(item, place)} t={t} />
          ))}
        </Group>
      ))}
    </>
  );
}

/** One item: its number and name, why it isn't ✓ and what it found, its state, and Fix. */
function ItemRow({ item, busy, onFix, t }: { item: ChecklistItem; busy: boolean; onFix: () => void; t: (key: Key, params?: Record<string, string | number>) => string }) {
  const why = item.why ? t(`stack.why.${item.why}` as Key) : '';
  const detail = [why, item.detail].filter(Boolean).join(': ');
  const tone = item.state === 'ok' ? 'ok' : item.state === 'fail' ? 'error' : item.state === 'warn' ? (item.fixing ? 'info' : 'warn') : 'info';
  const canFix = Boolean(item.fix) && (item.state === 'warn' || item.state === 'fail') && !item.fixing;
  return (
    <Row label={`${checklistNumber(item.id)}. ${t(`stack.item.${item.id}` as Key)}`} detail={detail}>
      <span>
        <Dot tone={tone} /> {t(`stack.checklist.${item.state}` as Key)}
        {canFix ? (
          <>
            {' '}
            <Button size="small" disabled={busy} onClick={onFix}>
              {busy ? t('stack.checklist.fixing') : t('stack.checklist.fix')}
            </Button>
          </>
        ) : null}
      </span>
    </Row>
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
