import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import s from './sheet.module.css';
import { thisComputer } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';

/** Someone sent you a beluga:// link: join their room (and leave the one you're in)? */
export function JoinSheet({ invite, onJoin, onCancel }: { invite: string; onJoin: () => void; onCancel: () => void }) {
  const t = useT();
  const room = useApp((st) => st.room);
  const others = useApp((st) => st.peers.length - 1);
  const host = (() => {
    try {
      return new URL(invite.replace(/^p2p:/, 'http:')).host || undefined;
    } catch {
      return undefined;
    }
  })();
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : onCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.sheet} aria-describedby={undefined}>
          <div className={s.head}>
            <Dialog.Title className={s.title}>{host ? t('sheets.join.titleAt', { host }) : t('sheets.join.title')}</Dialog.Title>
          </div>
          <div className={s.intro}>
            <p>{others > 0 ? t('sheets.join.leaveWith', { room, count: others, computer: thisComputer() }) : t('sheets.join.leave', { room, computer: thisComputer() })}</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 16px 16px' }}>
            <Button variant="quiet" onClick={onCancel}>
              {t('sheets.join.stay')}
            </Button>
            <Button variant="primary" onClick={onJoin} autoFocus>
              {t('sheets.join.join')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
