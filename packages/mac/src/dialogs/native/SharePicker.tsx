import { useState } from 'react';
import type { WsRole } from '@beluga/protocol.js';
import { Avatar, Button } from '../../components/ui.js';
import { Select } from '../settings-controls.js';
import s from './sharing.module.css';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';

/** A friend you could share with: why not yet, when their Beluga can't take it. */
export interface ShareCandidate {
  readonly peerId: string;
  readonly name: string;
  readonly why?: string;
}

export type Access = WsRole | 'none';

/** What someone you share with can do, as a row's pop-up offers it (removing them too). */
export const ACCESS = (): ReadonlyArray<{ value: Access; label: string }> => [
  { value: 'contribute', label: t('native.sharePicker.canWork') },
  { value: 'view', label: t('native.sharePicker.canFollow') },
  { value: 'none', label: t('native.sharePicker.remove') },
];

const LEVELS = (): ReadonlyArray<{ value: WsRole; label: string; description: string }> => [
  { value: 'contribute', label: t('native.sharePicker.canWork'), description: t('native.sharePicker.canWorkDetail') },
  { value: 'view', label: t('native.sharePicker.canFollow'), description: t('native.sharePicker.canFollowDetail') },
];

/**
 * The share sheets' add row (BLG-623): pick one of your friends who doesn't have it yet, pick what
 * they can do, Share. Who already has it is listed under it, each with their level.
 */
export function SharePicker({ candidates, onShare, none }: { readonly candidates: readonly ShareCandidate[]; readonly onShare: (peerId: string, role: WsRole) => void; readonly none: string }) {
  const t = useT();
  const [who, setWho] = useState('');
  const [role, setRole] = useState<WsRole>('contribute');
  const picked = candidates.find((c) => c.peerId === who);
  if (!candidates.length) return <div className={s.addNone}>{none}</div>;
  const share = (): void => {
    if (!picked || picked.why) return;
    onShare(picked.peerId, role);
    setWho('');
  };
  return (
    <div className={s.addWrap}>
      <div className={s.add}>
        <Select
          label={t('native.sharePicker.friend')}
          placeholder={t('native.sharePicker.choose')}
          value={picked ? picked.peerId : ''}
          width="full"
          options={candidates.map((c) => ({ value: c.peerId, label: c.name, icon: <Avatar name={c.name} id={c.peerId} size={16} />, ...(c.why ? { description: t('native.sharePicker.newer') } : {}) }))}
          onChange={setWho}
        />
        <Select<WsRole> label={t('native.sharePicker.whatTheyCanDo')} value={role} options={LEVELS()} onChange={setRole} />
        <Button onClick={share} disabled={!picked || Boolean(picked.why)}>
          {t('native.shareFolder.share')}
        </Button>
      </div>
      {picked?.why ? <p className={s.addWhy}>{picked.why}</p> : null}
    </div>
  );
}
