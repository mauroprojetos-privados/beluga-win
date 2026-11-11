import { useState } from 'react';
import type { ProjectSync } from '@beluga/core/board/model.js';
import { LINEAR_KEY_URL, linearKeyProblem } from '@beluga/shared/tracker-keys.js';
import { Alert, Checkbox } from '../components/Alert.js';
import { Field, FormSheet, Popup, TextInput, formStyles as f } from '../components/FormSheet.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { openExternal } from '../lib/system.js';
import { ago } from './tasks-model.js';
import { useBoard } from './use-tasks.js';
import s from './SyncSheet.module.css';
import { thisComputer } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';

interface Team {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

/**
 * Sync a project's tasks with Linear, both ways: paste a personal API key, pick the team, and
 * choose Autosync (every minute, and moments after a change here). Once connected: the team,
 * when it last synced, Sync Now, Autosync, and Disconnect. The key stays on this Mac.
 */
export function SyncSheet({ projectId, close }: { projectId: string; close: () => void }) {
  const sync = useBoard().sync?.[projectId];
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const [changing, setChanging] = useState(false);
  const t = useT();
  if (!project) return <FormSheet title={t('tasks.s.syncWithLinear')} intro={t('tasks.s.projectGone')} submitLabel={t('common.ok')} hideSubmit onSubmit={close} onCancel={close} />;
  if (sync && !changing) return <Connected projectId={projectId} name={project.name} sync={sync} onChange={() => setChanging(true)} close={close} />;
  return <ConnectForm projectId={projectId} name={project.name} close={close} onBack={sync ? () => setChanging(false) : undefined} />;
}

function ConnectForm({ projectId, name, close, onBack }: { projectId: string; name: string; close: () => void; onBack: (() => void) | undefined }) {
  const api = useApi();
  const t = useT();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [touched, setTouched] = useState(false);
  const [found, setFound] = useState<{ workspace?: string; teams: readonly Team[] }>();
  const [team, setTeam] = useState('');
  const [auto, setAuto] = useState(true);
  const [pushExisting, setPushExisting] = useState(false);
  const trimmed = key.trim();
  const problem = trimmed ? linearKeyProblem(trimmed) : undefined;
  return (
    <FormSheet
      title={onBack ? t('tasks.s.changeHow', { name }) : t('tasks.s.syncName', { name })}
      icon="refresh"
      intro={<p>{t('tasks.s.intro', { computer: thisComputer() })}</p>}
      submitLabel={found ? t('tasks.s.connect') : t('tasks.s.checkKey')}
      canSubmit={Boolean(trimmed) && !problem && (!found || Boolean(team))}
      cancelLabel={onBack ? t('common.back') : t('common.cancel')}
      onCancel={onBack ?? close}
      width={560}
      onSubmit={async () => {
        if (!found) {
          const r = await api.board.syncTeams('linear', trimmed);
          if (!r.ok) return r.error;
          if (!r.teams.length) return t('tasks.s.noTeams');
          setFound({ ...(r.workspace ? { workspace: r.workspace } : {}), teams: r.teams });
          setTeam(r.teams[0]!.id);
          return undefined;
        }
        const r = await api.board.syncConnect(projectId, { provider: 'linear', key: trimmed, teamId: team, auto, pushExisting });
        if (!r.ok) return r.error;
        // Connected: the sheet turns into how it syncs.
        setKey('');
        onBack?.();
        return undefined;
      }}
    >
      <Field
        label={t('tasks.s.apiKey')}
        htmlFor="linear-key"
        error={problem && touched ? problem : undefined}
        hint={found ? (found.workspace ? t('tasks.s.checkedIn', { workspace: found.workspace }) : t('tasks.s.checked')) : t('tasks.s.keyHint')}
        aside={
          <button type="button" className={s.reveal} aria-label={reveal ? t('tasks.s.hideKey') : t('tasks.s.showKey')} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
            <Icon name="eye" size={13} />
          </button>
        }
      >
        <TextInput
          id="linear-key"
          type={reveal ? 'text' : 'password'}
          mono
          placeholder="lin_api_…" // i18n-ignore: the key's own prefix
          value={key}
          invalid={Boolean(problem && touched)}
          onChange={(v) => {
            setKey(v);
            setFound(undefined);
          }}
          onBlur={() => setTouched(true)}
          data-autofocus
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      {found ? (
        <>
          <Field label={t('tasks.s.team')} htmlFor="linear-team" hint={t('tasks.s.teamHint')}>
            <Popup id="linear-team" label={t('tasks.s.team')} value={team} options={found.teams.map((x) => ({ value: x.id, label: `${x.name} (${x.key})` }))} onChange={setTeam} />
          </Field>
          <div className={s.options}>
            <Checkbox checked={auto} onChange={setAuto} label={t('tasks.s.autosync')} detail={t('tasks.s.autosyncDetail')} />
            <Checkbox checked={pushExisting} onChange={setPushExisting} label={t('tasks.s.alsoSend')} detail={t('tasks.s.alsoSendDetail')} />
          </div>
        </>
      ) : (
        <div className={s.howto}>
          <span>{t('tasks.s.noKeyYet')}</span>
          <button type="button" className={f.linkButton} onClick={() => void openExternal(LINEAR_KEY_URL)}>
            {t('tasks.s.createOne')}
            <Icon name="forward" size={10} />
          </button>
        </div>
      )}
    </FormSheet>
  );
}

function Connected({ projectId, name, sync, onChange, close }: { projectId: string; name: string; sync: ProjectSync; onChange: () => void; close: () => void }) {
  const api = useApi();
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <Alert
        title={t('tasks.s.stopTitle', { name })}
        message={t('tasks.s.stopMessage')}
        tone="danger"
        confirm={{
          label: t('tasks.s.disconnect'),
          destructive: true,
          onClick: () => {
            void api.board.syncDisconnect(projectId);
            close();
          },
        }}
        onCancel={() => setConfirm(false)}
      />
    );
  }
  return (
    <FormSheet
      title={t('tasks.s.syncsWith', { name })}
      icon="refresh"
      intro={
        <span className={s.team}>
          {sync.workspace ? `${sync.workspace} · ` : ''}
          {sync.team} <span className={s.teamKey}>{sync.teamKey}</span>
        </span>
      }
      submitLabel={t('common.done')}
      hideSubmit
      cancelLabel={t('common.done')}
      width={480}
      onSubmit={() => undefined}
      onCancel={close}
      footer={
        <>
          <button type="button" className={f.linkDanger} onClick={() => setConfirm(true)}>
            {t('tasks.s.disconnectMenu')}
          </button>
          <button type="button" className={f.linkButton} onClick={onChange}>
            {t('tasks.s.changeTeamKey')}
          </button>
        </>
      }
    >
      <div className={cx(s.status, sync.syncing && s.busy)} aria-live="polite">
        <span className={s.count}>{t('tasks.s.linked', { count: sync.linked })}</span>
        <span className={s.meta}>
          {sync.syncing ? t('tasks.s.syncing') : sync.syncedAt ? t('tasks.s.synced', { when: ago(sync.syncedAt) }) : t('tasks.s.notSynced')}
          <button type="button" className={f.linkButton} disabled={sync.syncing} onClick={() => void api.board.syncNow(projectId)}>
            {t('tasks.v.syncNow')}
          </button>
        </span>
      </div>
      {sync.error ? (
        <div className={s.problem} role="status">
          <Icon name="alert" size={13} />
          <span>{sync.error.message}</span>
          {sync.error.code === 'auth' ? (
            <button type="button" className={f.linkButton} onClick={onChange}>
              {t('tasks.s.newKey')}
            </button>
          ) : null}
        </div>
      ) : null}
      <Checkbox checked={sync.auto} onChange={(on) => void api.board.syncAuto(projectId, on)} label={t('tasks.s.autosync')} detail={t('tasks.s.autosyncOff')} />
      <div className={s.note}>{t('tasks.s.keptInStep')}</div>
    </FormSheet>
  );
}
