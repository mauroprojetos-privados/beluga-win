import { useState } from 'react';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Alert, Checkbox } from '../../components/Alert.js';
import { useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import { useT } from '../../lib/i18n.js';

/** Clear a conversation. The choice the terminal lists (for everyone, a fresh Claude) is a checkbox. */
export function ClearAlert({ menu, close }: NativeMenuProps<'clear'>) {
  const pick = usePick(menu);
  const t = useT();
  const ws = useApp((st) => (menu.channel.startsWith('ws:') ? findWorkspace(st.projects, menu.channel.slice(3)) : undefined));
  const [more, setMore] = useState(false);
  if (menu.channel === 'room') {
    return (
      <Alert
        icon="chat"
        tone="caution"
        title={t('native.clear.roomTitle')}
        message={menu.host ? t('native.clear.roomHost') : t('native.clear.roomGuest')}
        confirm={{ label: t('native.clear.clear'), destructive: true, onClick: () => pick(more ? 'clear-everyone' : 'clear-mine') }}
        onCancel={close}
      >
        {menu.host ? <Checkbox checked={more} onChange={setMore} label={t('native.clear.forEveryone')} detail={t('native.clear.forEveryoneDetail')} /> : null}
      </Alert>
    );
  }
  return (
    <Alert
      icon="chat"
      tone="caution"
      title={t('native.clear.title', { name: ws?.name ?? t('native.clear.thisConversation') })}
      message={more ? t('native.clear.fresh') : t('native.clear.remembers')}
      confirm={{ label: t('native.clear.clear'), destructive: true, onClick: () => pick(more ? 'clear-fresh' : 'clear-mine') }}
      onCancel={close}
    >
      {ws ? <Checkbox checked={more} onChange={setMore} label={t('native.clear.startFresh')} detail={t('native.clear.startFreshDetail')} /> : null}
    </Alert>
  );
}
