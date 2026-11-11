import { type MissedCallView, missedCallText } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { useBeluga } from '../lib/beluga.js';
import { useCallEngine, useCallUnreachable, useConversationCall } from './use-call.js';
import { useT } from '../lib/i18n.js';
import c from './call.module.css';

/** "Ann tried calling you at 14:05" where it rang in the conversation, with Call Back while they can be reached. */
export function MissedCall({ missed }: { missed: MissedCallView }) {
  const t = useT();
  const { client } = useBeluga();
  const engine = useCallEngine();
  const unreachable = useCallUnreachable(missed.conversation);
  const going = useConversationCall(missed.conversation);
  const callBack = (): void =>
    void engine.start(missed.conversation).catch((err: unknown) => client.store.dispatch({ type: 'toast', text: t('network.call.couldntStart', { error: err instanceof Error ? err.message : String(err) }), level: 'error' }));
  return (
    <div className={c.missed} role="note">
      <span className={c.missedIcon} aria-hidden="true">
        <Icon name="call" size={12} />
      </span>
      <span>{missedCallText(missed)}</span>
      {!unreachable && !going ? (
        <button type="button" className={c.missedBack} onClick={callBack}>
          {t('network.missed.callBack')}
        </button>
      ) : null}
    </div>
  );
}
