import { useEffect, useState } from 'react';
import type { EnvChange } from '@beluga/workspaces/env.js';
import type { EnvSendAsk, EnvSendChoice } from '@beluga/shared/env-send.js';
import { EnvKeys } from '../../dialogs/native/ConfirmAlert.js';
import { Icon } from '../../components/Icon.js';
import { ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, IconButton, Tip } from '../../components/ui.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import { sameDeep } from '../../lib/stable.js';
import s from './env-asks.module.css';
import { useT } from '../../lib/i18n.js';

const NONE: readonly EnvChange[] = [];
const NO_SENDS: readonly EnvSendAsk[] = [];

/**
 * A worktree made on one of your computers whose project folder there lacks .env files this Mac has
 * (BLG-800): their names only, then Send Once, Don't Send, or behind ••• Always for This Project
 * (Settings › Your Computers takes it back). Sent over the encrypted link, written 0600 there.
 */
function EnvSendRow({ ask }: { ask: EnvSendAsk }) {
  const { client } = useBeluga();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const decide = (choice: EnvSendChoice): void => {
    setBusy(true);
    void client.call('machines.env.decide', ask.id, choice).finally(() => setBusy(false));
  };
  return (
    <div className={s.ask} role="status" aria-label={t('project.env.sendTo', { machine: ask.machineName })}>
      <Icon name="lock" size={13} className={s.icon} />
      <span className={s.text}>
        <strong>{ask.machineName}</strong> {t('project.env.hasNo')}
        {ask.files.map((f) => (
          <code key={f}>{f}</code>
        ))}
        {t('project.env.forProject', { project: ask.projectName })}
        <span className={s.detail}> · {t('project.env.sendThisMacs')}</span>
      </span>
      <Tip label={t('project.env.sendOnceTip')}>
        <Button size="small" disabled={busy} onClick={() => decide('once')}>
          {t('project.env.sendOnce')}
        </Button>
      </Tip>
      <Button size="small" variant="quiet" disabled={busy} onClick={() => decide('never')}>
        {t('project.env.dontSend')}
      </Button>
      <ActionsDropdown items={[{ label: t('project.env.always'), hint: t('project.env.alwaysHint'), onSelect: () => decide('always') }]}>
        <IconButton icon="more" label={t('project.env.moreSend')} disabled={busy} />
      </ActionsDropdown>
    </div>
  );
}

/**
 * A worktree changed a .env value the main folder doesn't have (BLG-369; brand-new keys went there
 * on their own): its keys, then Copy to Main Folder (every worktree's untouched copy follows), Save
 * in Beluga (every run gets them, the file stays), or behind ••• Keep in This Worktree Only.
 */
function EnvAsk({ wsId, changes, name }: { wsId: string; changes: readonly EnvChange[]; name?: string }) {
  const api = useApi();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const files = changes.map((c) => c.file);
  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    void run().finally(() => setBusy(false));
  };
  return (
    <div className={s.ask} role="status" aria-label={t('project.env.changesHere')}>
      <Icon name="lock" size={13} className={s.icon} />
      <span className={s.text}>
        {name ? <strong>{name} </strong> : null}
        {t('project.env.changed')} {files.length === 1 ? <code>{files[0]}</code> : t('project.env.envFiles', { n: files.length })}
        {changes.length === 1 ? (
          <>
            {' '}
            <EnvKeys change={changes[0]!} />
          </>
        ) : null}
        <span className={s.detail}>{name ? '' : ` · ${t('project.env.mainLacks')}`}</span>
      </span>
      <Tip label={t('project.env.copyTip')}>
        <Button size="small" disabled={busy} onClick={() => act(() => api.workspaces.applyEnvBack(wsId))}>
          {t('project.env.copyToMain')}
        </Button>
      </Tip>
      <Tip label={t('project.env.saveTip')}>
        <Button size="small" variant="quiet" disabled={busy} onClick={() => act(() => api.workspaces.saveEnvInBeluga(wsId))}>
          {t('project.env.saveInBeluga')}
        </Button>
      </Tip>
      <ActionsDropdown items={[{ label: t('project.env.keepHere'), hint: t('project.env.keepHereHint'), onSelect: () => act(() => api.workspaces.keepEnvHere(wsId)) }]}>
        <IconButton icon="more" label={t('project.env.moreChanges')} disabled={busy} />
      </ActionsDropdown>
    </div>
  );
}

/** In a worktree's conversation, under its other strips. */
export function EnvStrip({ workspaceId }: { workspaceId: string }) {
  const changes = useApp((st) => st.envAsks[workspaceId] ?? NONE);
  const sends = useApp((st) => (st.envSends ?? NO_SENDS).filter((a) => a.workspaceIds.includes(workspaceId)), sameDeep);
  const projectId = useApp((st) => st.projects.find((p) => p.workspaces.some((w) => w.id === workspaceId))?.id);
  const api = useApi();
  // Opening it looks again (an edit made outside Beluga since).
  useEffect(() => {
    if (projectId) void api.workspaces.checkEnv(projectId).catch(() => undefined);
  }, [workspaceId, projectId]);
  if (!changes.length && !sends.length) return null;
  return (
    <div className={s.strip}>
      {sends.map((a) => (
        <EnvSendRow key={a.id} ask={a} />
      ))}
      {changes.length ? <EnvAsk wsId={workspaceId} changes={changes} /> : null}
    </div>
  );
}

/** On a project's page: each of its worktrees that changed a .env. */
export function ProjectEnvAsks({ projectId }: { projectId: string }) {
  const api = useApi();
  const asks = useApp((st) => {
    const ws = st.projects.find((p) => p.id === projectId)?.workspaces ?? [];
    return ws.filter((w) => st.envAsks[w.id]?.length).map((w) => ({ id: w.id, name: w.name, changes: st.envAsks[w.id]! }));
  }, sameDeep);
  const sends = useApp((st) => (st.envSends ?? NO_SENDS).filter((a) => a.projectId === projectId), sameDeep);
  useEffect(() => {
    void api.workspaces.checkEnv(projectId).catch(() => undefined);
  }, [projectId]);
  if (!asks.length && !sends.length) return null;
  return (
    <div className={s.list}>
      {sends.map((a) => (
        <EnvSendRow key={a.id} ask={a} />
      ))}
      {asks.map((a) => (
        <EnvAsk key={a.id} wsId={a.id} name={a.name} changes={a.changes} />
      ))}
    </div>
  );
}

/** The project page's Environment pill: how many it sets here, and the sheet to change them. */
export function EnvPill({ projectId, root }: { projectId: string; root: string }) {
  const own = useApp((st) => st.envKeys.projects[root]?.keys.length ?? 0);
  const off = useApp((st) => st.envKeys.projects[root]?.dotenv === false);
  const t = useT();
  return (
    <Tip label={off ? t('project.env.pillOff') : t('project.env.pill')}>
      <button type="button" className={s.pill} onClick={() => openSheet({ kind: 'project_env', projectId })}>
        <Icon name="lock" size={11} />
        {t('project.env.environment')}
        {own ? <strong>{own}</strong> : null}
      </button>
    </Tip>
  );
}
