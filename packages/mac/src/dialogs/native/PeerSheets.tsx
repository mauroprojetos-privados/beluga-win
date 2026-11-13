import { useState } from 'react';
import { Button } from '../../components/ui.js';
import type { View } from '@beluga/core/store.js';
import type { PeerInfo } from '@beluga/protocol.js';
import type { Actions } from '../../lib/actions.js';
import { useActions } from '../../lib/actions.js';
import { type Recipient, type UiStore, toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { Field, Sheet } from './parts.js';
import s from './sharing.module.css';
import { useT } from '../../lib/i18n.js';

/** A conversation is on screen (where a message, or a command's output, shows up). */
const chatShown = (v: View): boolean => v.kind === 'room' || ((v.kind === 'workspace' || v.kind === 'shared') && v.tab === 'chat');

/**
 * Start a message to someone: the composer shows "To bob" (or "To bob's Claude") as a chip, and
 * what you type goes to them. Messages to a person go to the room's chat; asking a Claude stays
 * in the conversation you're in (or the room's, when none is on screen).
 */
export function addressTo(ui: UiStore, actions: Actions, view: View, to: Recipient): void {
  if (!to.claude || !chatShown(view)) actions.run({ type: 'view', view: { kind: 'room' } });
  ui.patch({ to, menu: undefined, focus: 'chat' });
  setTimeout(() => document.dispatchEvent(new CustomEvent('beluga:focus-composer')), 30);
}

/** Run a command on a friend's computer: type it here, they approve (unless they fully trust you). */
export function RunCommandSheet({ peer, close }: { peer: PeerInfo; close: () => void }) {
  const api = useApi();
  const actions = useActions();
  const t = useT();
  const { client } = useBeluga();
  const level = useApp((st) => st.granted[peer.peerId]?.level);
  const [cmd, setCmd] = useState('');
  const run = (): void => {
    const command = cmd.trim();
    if (!command) return;
    const view = client.store.getState().view;
    const here = chatShown(view) && view.kind !== 'room' ? `ws:${(view as { id: string }).id}` : 'room';
    if (here === 'room') actions.run({ type: 'view', view: { kind: 'room' } });
    api.session.runOnPeerByHand(peer.name, command, here).catch((err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'));
    close();
  };
  return (
    <Sheet
      title={t('native.workSheets.runOn', { name: peer.name })}
      subtitle={level === 'full' ? t('native.peer.runsRightAway') : t('native.peer.approvesFirst', { name: peer.name })}
      icon="terminal"
      close={close}
      onReturn={run}
      footer={
        <>
          <span />
          <ButtonRow onCancel={close} onOk={run} ok={t('native.person.run')} disabled={!cmd.trim()} />
        </>
      }
    >
      <Field label={t('native.workSheets.command')} htmlFor="peer-command">
        {/* i18n-ignore: a command */}
        <input id="peer-command" className={s.input} style={{ fontFamily: 'var(--font-mono)' }} value={cmd} placeholder="npm test" spellCheck={false} autoFocus onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), run())} />
        <span className={s.hint}>{t('native.peer.runsIn', { name: peer.name })}</span>
      </Field>
    </Sheet>
  );
}

function ButtonRow({ onCancel, onOk, ok, disabled }: { onCancel: () => void; onOk: () => void; ok: string; disabled?: boolean }) {
  const t = useT();
  return (
    <>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={disabled} onClick={onOk}>
        {ok}
      </Button>
    </>
  );
}
