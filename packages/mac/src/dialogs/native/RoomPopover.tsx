import * as Popover from '@radix-ui/react-popover';
import { Avatar, Button, Dot } from '../../components/ui.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { Switch } from '../settings-controls.js';
import { openPerson } from './PersonPopover.js';
import { useFlash } from './parts.js';
import p from './person.module.css';
import r from './room.module.css';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';

type Tone = 'ok' | 'warn' | 'error';

const invite = (): void => void document.dispatchEvent(new CustomEvent('beluga:invite-room'));

/** What remote access is doing, in words. */
function reach(phase: string | undefined, detail: string | undefined, hasLink: boolean): string {
  if (phase === 'ready' || hasLink) return t('native.room.reachReady');
  if (phase === 'local') return t('native.room.reachLocal');
  if (phase === 'failed') return detail ?? t('native.room.reachFailed');
  if (phase) return t('native.room.reachOpening');
  return t('native.room.reachLater');
}

/**
 * The room's status at the bottom of the sidebar ("3 people in kay's room"), as a button: it
 * opens the room's card with who's here, whether new people can join, and its link.
 */
export function RoomStatus({ label, tone }: { label: string; tone: Tone }) {
  const api = useApi();
  const t = useT();
  const { ui } = useBeluga();
  const room = useApp((st) => st.room);
  const peers = useApp((st) => st.peers);
  const selfId = useApp((st) => st.selfId);
  const host = useApp((st) => st.self?.host === true);
  const roomOpen = useApp((st) => st.roomOpen);
  const link = useApp((st) => st.invite);
  const hosting = useApp((st) => st.hosting);
  const status = useApp((st) => st.status);
  const [copied, flash] = useFlash();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={r.status} title={room} aria-label={t('native.room.detailsAria', { label })}>
          <Dot tone={tone} />
          <span className={r.statusLabel}>{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${p.card} ${r.card}`} side="top" align="start" sideOffset={8} collisionPadding={10} aria-label={t('native.room.room')}>
          <div className={r.head}>
            <div className={r.room}>{room}</div>
            <div className={r.line}>
              <Dot tone={tone} />
              {status === 'connected' ? (host ? t('native.room.youHost') : t('native.room.connected')) : status === 'connecting' ? t('native.room.connecting') : t('native.room.offline')}
            </div>
            {host ? <div className={r.dim}>{reach(hosting?.phase, hosting?.detail, Boolean(link))}</div> : null}
          </div>
          <div className={r.people} role="list" aria-label={t('native.room.peopleHere')}>
            {peers.map((x, index) => (
              <Popover.Close asChild key={x.peerId}>
                <button
                  type="button"
                  role="listitem"
                  className={r.person}
                  onClick={() => setTimeout(() => openPerson(ui, index, document.querySelector<HTMLElement>(`[data-person-row="${CSS.escape(x.peerId)}"]`)), 0)}
                  title={x.peerId === selfId ? t('native.wsShare.you', { name: x.name }) : x.name}
                >
                  <Avatar name={x.name} id={x.peerId} size={28} />
                  <span>{x.peerId === selfId ? t('native.shared.you') : x.name}</span>
                </button>
              </Popover.Close>
            ))}
          </div>
          {host ? (
            <div className={r.row}>
              <div>
                <div>{t('native.room.canJoin')}</div>
                <div className={r.dim}>{roomOpen ? t('native.room.openDetail') : t('native.room.closedDetail')}</div>
              </div>
              <Switch label={t('native.room.canJoin')} on={roomOpen} onChange={(v) => void api.session.setRoomOpen(v)} />
            </div>
          ) : null}
          <div className={r.buttons}>
            {link ? (
              <Button icon={copied ? 'check' : 'copy'} onClick={() => void api.session.copyInvite().then(() => flash('room'))}>
                {copied ? t('native.copied') : t('native.invite.copyRoomLink')}
              </Button>
            ) : null}
            <Popover.Close asChild>
              <Button variant="primary" icon="link" onClick={invite}>
                {t('native.room.invitePeople')}
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
