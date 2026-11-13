import { useState } from 'react';
import type { SharedFork } from '@beluga/core/friend-share-store.js';
import { trustOf } from '@beluga/core/trust.js';
import { formatBytes } from '@beluga/shared/format.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Field, FormSheet, TextInput } from '../../components/FormSheet.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { Button, Tip } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import s from './fork-to-mac.module.css';
import m from './menus.module.css';
import { computerTitle, thisComputer } from '../../lib/os-words.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';
import { rich } from './parts.js';

/** The folder and branch name Beluga makes from a name (as the core's `slug` does). */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function Row({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return (
    <li className={s.row}>
      <span className={s.icon}>
        <Icon name={icon} size={13} />
      </span>
      <span>
        <span className={s.title}>{title}</span>
        <span className={s.detail}>{detail}</span>
      </span>
    </li>
  );
}

/**
 * Fork a friend's shared worktree to this Mac (BLG-312): what comes over, what stays behind, a
 * name, then one button. Their worktree goes on as it is; yours is yours.
 */
export function ForkToMacSheet({ owner, wsId, close }: { owner: string; wsId: string; close: () => void }) {
  const api = useApi();
  const t = useT();
  const ws = useApp((st) => st.shared.find((w) => w.id === wsId && w.owner === owner));
  const ownerName = useApp((st) => st.sharedProjects.find((p) => p.owner === owner)?.ownerName ?? st.network.friends.find((f) => f.peerId === owner)?.name) ?? t('native.fork.yourFriend');
  const full = useApp((st) => trustOf(st, owner) === 'full');
  const [name, setName] = useState(ws?.name ?? '');
  if (!ws) return null;
  return (
    <FormSheet
      title={t('native.fork.title', { name: ws.name, computer: computerTitle() })}
      icon="laptop"
      intro={t('native.fork.intro', { owner: ownerName })}
      submitLabel={t('native.fork.fork')}
      canSubmit={Boolean(slug(name))}
      onSubmit={async () => {
        await api.sharing.fork(owner, wsId, name.trim());
        close();
      }}
      onCancel={close}
      width={540}
    >
      <Field label={t('native.fork.comesWithIt')}>
        <ul className={s.list}>
          <Row icon="branch" title={t('native.fork.commits')} detail={t('native.fork.commitsDetail')} />
          <Row icon="folder" title={t('native.fork.scratch')} detail={t('native.fork.scratchDetail')} />
          <Row icon="chat" title={t('native.fork.conversation')} detail={t('native.fork.conversationDetail')} />
        </ul>
      </Field>
      <Field label={t('native.fork.staysBehind')}>
        <div className={m.note}>
          <Icon name="eyeOff" size={14} />
          <span>{t('native.fork.staysBehindDetail')}</span>
        </div>
      </Field>
      {full ? null : (
        <div className={m.note}>
          <Icon name="lock" size={14} />
          <span>{t('native.fork.notTrusted', { owner: ownerName })}</span>
        </div>
      )}
      <Field label={t('native.fork.name')} htmlFor="fork-mac-name" hint={slug(name) ? rich(t('native.fork.yourBranch'), { branch: <code>beluga/{slug(name)}</code> }) : undefined}>
        <TextInput id="fork-mac-name" value={name} onChange={setName} maxLength={120} spellCheck={false} />
      </Field>
    </FormSheet>
  );
}

/**
 * A fork coming over, in the header: how much of it is here, with a bar that fills, then that it's
 * being set up. Hover for the sizes and how many files are in it.
 */
function ForkProgress({ fork }: { fork: SharedFork }) {
  const { total } = fork;
  const t = useT();
  if (total === undefined) {
    // A Mac on an older Beluga doesn't say how big it is.
    return (
      <Tip label={t('native.fork.comingOver')}>
        <span className={s.progress} role="status">
          <Icon name="laptop" size={14} />
          {t('native.fork.copying')}
        </span>
      </Tip>
    );
  }
  const received = Math.min(fork.received ?? 0, total);
  const here = received >= total;
  const pct = total ? Math.floor((received / total) * 100) : 100;
  const files = fork.files ? t('native.fork.files', { count: fork.files }) : '';
  const tip = here ? t('native.fork.allHere') : t('native.fork.progressTip', { received: formatBytes(received), total: formatBytes(total), files });
  return (
    <Tip label={tip}>
      <span className={s.progress} role="progressbar" aria-label={here ? t('native.fork.settingUpFork') : t('native.fork.copyingFork')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <Icon name="laptop" size={14} />
        {here ? t('native.fork.settingUp') : t('native.fork.copyingPct', { pct })}
        <span className={s.bar} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
    </Tip>
  );
}

/**
 * In a friend's worktree you work in (shared over the network), in its header: Fork to My {computerTitle()},
 * how far a fork got (waiting for their Mac, copying), and Open My Fork once it's made.
 */
export function ForkToMacButton({ owner, wsId }: { owner: string; wsId: string }) {
  const actions = useActions();
  const t = useT();
  const ws = useApp((st) => st.shared.find((w) => w.id === wsId && w.owner === owner));
  const fork = useApp((st) => st.forks[wsId]);
  const mine = useApp((st) => (fork?.wsId ? findWorkspace(st.projects, fork.wsId) : undefined));
  const ownerName = useApp((st) => st.network.friends.find((f) => f.peerId === owner)?.name);
  const online = useApp((st) => Boolean(st.network.friends.find((f) => f.peerId === owner)?.online));
  if (!ws || ws.via !== 'mesh' || ws.role !== 'contribute') return null;
  if (fork?.state === 'ready' && mine && !mine.archived) {
    return (
      <Tip label={t('native.fork.yourForkOn', { branch: mine.branch ?? t('native.fork.ownBranch') })}>
        <Button variant="quiet" icon="laptop" onClick={() => actions.run({ type: 'view', view: { kind: 'workspace', id: mine.id, tab: 'chat' } })}>
          {t('native.fork.openMyFork')}
        </Button>
      </Tip>
    );
  }
  if (fork?.state === 'copying') return <ForkProgress fork={fork} />;
  if (fork?.state === 'preparing') {
    const project = ws.project ?? t('native.fork.theProject');
    return (
      <Tip label={t('native.fork.notHereYet', { project, computer: thisComputer() })}>
        <Button variant="quiet" icon="download" disabled aria-busy="true">
          {t('native.fork.getting', { project })}
        </Button>
      </Tip>
    );
  }
  if (fork?.state === 'asking') {
    return (
      <Tip label={online ? (ownerName ? t('native.fork.packingTip', { owner: ownerName }) : t('native.fork.packingTipTheir')) : t('native.fork.whenBack')}>
        <Button variant="quiet" icon="laptop" disabled aria-busy="true">
          {online ? t('native.fork.packing') : ownerName ? t('native.fork.waitingFor', { owner: ownerName }) : t('native.fork.waitingForTheir')}
        </Button>
      </Tip>
    );
  }
  return (
    <Tip label={fork?.state === 'failed' ? t('native.fork.lastTime', { error: fork.error ?? t('native.fork.didntWork') }) : t('native.fork.ownCopy', { computer: thisComputer() })}>
      <Button variant="quiet" icon="laptop" onClick={() => openSheet({ kind: 'fork_to_mac', owner, wsId })}>
        {t('native.fork.forkToMy', { computer: computerTitle() })}
      </Button>
    </Tip>
  );
}
