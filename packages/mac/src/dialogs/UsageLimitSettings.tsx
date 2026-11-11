import { resetWords } from '@beluga/shared/run-failure.js';
import { Button } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { Group, Row, Switch } from './settings-controls.js';
import { say, useT } from '../lib/i18n.js';

/**
 * Settings › Agent › Usage limits (BLG-757): an agent that stopped on your plan's usage limit is
 * told to continue once it resets. On by default; the limit card turns it off for one chat or for
 * this session, and the rows here undo that. Turned back on here, it starts from now: runs whose
 * reset already passed while it was off aren't sent on all at once.
 */
export function UsageLimitSettings() {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const p = useApp((st) => st.prefs);
  const set = (patch: Parameters<typeof api.session.setPrefs>[0]): void => void api.session.setPrefs(patch).catch((err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'));
  const now = Date.now();
  const skipping = p.autoContinue && p.autoContinueSkip > now;
  const chats = p.autoContinueOff.length;
  return (
    <Group title={say('Usage limits')}>
      <Row label={say('Continue when your usage limit resets')} detail={p.autoContinue ? t('prefs.usageLimit.continueOn') : t('prefs.usageLimit.continueOff')}>
        <Switch label={say('Continue when your usage limit resets')} on={p.autoContinue} onChange={(v) => set(v ? { autoContinue: true, autoContinueSkip: Date.now() } : { autoContinue: false })} />
      </Row>
      {skipping ? (
        <Row label={say('Skipped this session')} detail={t('prefs.usageLimit.skippedDetail', { when: resetWords(p.autoContinueSkip, now) })}>
          <Button size="small" onClick={() => set({ autoContinueSkip: 0 })}>
            {t('prefs.usageLimit.turnBackOn')}
          </Button>
        </Row>
      ) : null}
      {p.autoContinue && chats > 0 ? (
        <Row label={say('Chats it’s off in')} detail={t('prefs.usageLimit.offInDetail', { count: chats })}>
          <Button size="small" onClick={() => set({ autoContinueOff: [] })}>
            {t('prefs.usageLimit.turnOnAll')}
          </Button>
        </Row>
      ) : null}
    </Group>
  );
}
