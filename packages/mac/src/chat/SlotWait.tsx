import { type SlotWait, slotWaitLine, slotWaitTitle } from '@beluga/shared/run-slots.js';
import { Icon } from '../components/Icon.js';
import { Button, Tip } from '../components/ui.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import s from './slot-wait.module.css';

/**
 * A message that waits only because your Claude already works in as many conversations as it may
 * at once (Settings › Claude › Working at once): says so, shows them as busy pills, and offers to
 * start it anyway or change the limit. `requestId`: yours to start now (else just the words).
 */
export function SlotWaitNotice({ wait, requestId }: { wait: SlotWait; requestId?: string }) {
  const { client, ui } = useBeluga();
  const t = useT();
  const busy = Math.max(wait.running, wait.limit);
  const startNow = (): void =>
    void client.api.host.promote(requestId ?? '').catch((err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'));
  return (
    <div className={s.wait} role="status">
      <span className={s.icon}>
        <Icon name="gauge" size={14} />
      </span>
      <div className={s.body}>
        <div className={s.title}>{slotWaitTitle()}</div>
        <div className={s.detail}>{slotWaitLine(wait)}</div>
        <Tip label={t('chat.slot.atOnce', { busy, limit: wait.limit })}>
          <span className={s.pills} aria-label={t('chat.slot.working', { busy, limit: wait.limit })}>
            {Array.from({ length: Math.min(busy, 30) }, (_, i) => (
              <span key={i} className={s.pill} />
            ))}
          </span>
        </Tip>
        {requestId ? (
          <div className={s.actions}>
            <Button size="small" icon="play" onClick={startNow} title={t('chat.slot.startNowTip')}>
              {t('chat.slot.startNow')}
            </Button>
            <Button size="small" variant="quiet" icon="gear" onClick={() => ui.patch({ settings: 'claude' })} title={t('chat.slot.changeTip')}>
              {t('chat.slot.change')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
