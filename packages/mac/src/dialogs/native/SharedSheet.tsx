import { useState } from 'react';
import type { SharedTab } from '@beluga/core/store.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { Avatar, Button } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { Alert, Section, Sheet, Tag } from './parts.js';
import s from './sharing.module.css';
import v from './shared.module.css';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';

const OPEN = (): ReadonlyArray<{ tab: SharedTab; label: string; icon: IconName; detail: string }> => [
  { tab: 'chat', label: t('native.wsShare.chat'), icon: 'chat', detail: t('native.shared.chatDetail') },
  { tab: 'files', label: t('native.person.files'), icon: 'folder', detail: t('native.shared.filesDetail') },
  { tab: 'diff', label: t('native.shared.changes'), icon: 'diff', detail: t('native.shared.changesDetail') },
];

/** A workspace someone shared with you: what you can do there, who's in it, and leaving. */
export function SharedSheet({ menu, close }: NativeMenuProps<'shared'>) {
  const api = useApi();
  const actions = useActions();
  const t = useT();
  const w = useApp((st) => st.shared.find((x) => x.owner === menu.owner && x.id === menu.id));
  const peers = useApp((st) => st.peers);
  const roster = useApp((st) => st.roster[menu.id]) ?? [];
  const selfId = useApp((st) => st.selfId);
  const [leaving, setLeaving] = useState(false);
  if (!w) return null;
  const owner = peers.find((p) => p.peerId === w.owner)?.name ?? t('native.someone');
  const nameOf = (id: string): string => (id === selfId ? t('native.shared.you') : (peers.find((p) => p.peerId === id)?.name ?? t('native.shared.someone')));
  if (leaving) {
    return (
      <Alert
        title={t('native.shared.leaveTitle', { name: w.name })}
        message={t('native.shared.leaveMessage', { owner })}
        confirm={t('native.person.leave')}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          void api.sharing.leave(w.owner, w.id);
          close();
        }}
      />
    );
  }
  const open = (tab: SharedTab): void => {
    close();
    actions.run({ type: 'open_shared', owner: w.owner, id: w.id, tab });
  };
  return (
    <Sheet
      title={t('native.shared.title', { owner, name: w.name })}
      subtitle={`${w.project}${w.branch ? ` · ${w.branch}` : ''}`}
      badge={<Avatar name={owner} id={w.owner} size={36} />}
      close={close}
      footer={
        <>
          <Button variant="danger" onClick={() => setLeaving(true)}>
            {t('native.shared.leave')}
          </Button>
          <Button variant="primary" onClick={close}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <div className={v.role}>
        <Tag tone={w.role === 'contribute' ? 'claude' : 'muted'}>{w.role === 'contribute' ? t('native.shared.canWork') : t('native.shared.following')}</Tag>
        <span>{w.role === 'contribute' ? t('native.shared.talkTo', { owner }) : t('native.shared.readOnly')}</span>
      </div>
      <div className={v.tiles}>
        {OPEN().map((o) => (
          <button key={o.tab} type="button" className={v.tile} onClick={() => open(o.tab)}>
            <Icon name={o.icon} size={18} />
            <span className={v.tileLabel}>{o.label}</span>
            <span className={v.tileDetail}>{o.detail}</span>
          </button>
        ))}
      </div>
      <Section title={t('native.shared.inWorkspace')}>
        <div className={s.list} role="list" aria-label={t('native.shared.inWorkspace')}>
          <div role="listitem" className={s.item}>
            <Avatar name={owner} id={w.owner} size={22} />
            <span className={s.itemText}>
              <span className={s.itemTitle}>{owner}</span>
            </span>
            <Tag>{t('native.wsShare.owner')}</Tag>
          </div>
          {roster
            .filter((r) => r.peerId !== w.owner)
            .map((r) => (
              <div key={r.peerId} role="listitem" className={s.item}>
                <Avatar name={nameOf(r.peerId)} id={r.peerId} size={22} />
                <span className={s.itemText}>
                  <span className={s.itemTitle}>{nameOf(r.peerId)}</span>
                </span>
                <Tag tone="muted">{r.role === 'contribute' ? t('native.wsShare.worksHere') : t('native.wsShare.follows')}</Tag>
              </div>
            ))}
        </div>
      </Section>
    </Sheet>
  );
}
