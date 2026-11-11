import { Segmented } from '../components/ui.js';
import { type ConvoMode, convoModeOf, withConvoMode } from '../lib/convo-mode.js';
import { getPrefs, setPrefs, usePrefs } from '../lib/prefs.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { useTerminalCapable } from './ConvoCenter.js';
import { useT } from '../lib/i18n.js';

/** Room the switch takes in the header, with words and as icons only. */
export const SWITCH_W = 236;
export const SWITCH_ICONS_W = 104;

/** Show a conversation as the chat, its agent's terminal, or both (BLG-534). */
export function setConvoMode(wsId: string, mode: ConvoMode): void {
  setPrefs({ convoModes: withConvoMode(getPrefs().convoModes, wsId, mode) });
}

/** The header's Chat · Terminal · Both, for a conversation that can have a terminal. */
export function ConvoSwitch({ wsId, iconOnly }: { readonly wsId: string; readonly iconOnly?: boolean }) {
  const prefs = usePrefs();
  const t = useT();
  const capable = useTerminalCapable(wsId);
  // Only for people who turned the terminal view on (Settings › Terminal): everyone else has the chat.
  if (!capable || !prefs.termView) return null;
  const mode = convoModeOf(prefs.convoModes, prefs.convoDefault, wsId);
  return (
    <Segmented
      label={t('chat.convo.showAs')}
      value={mode}
      iconOnly={iconOnly}
      onChange={(m) => setConvoMode(wsId, m)}
      options={[
        { value: 'chat', label: t('chat.convo.chat'), icon: 'chat', hint: t('chat.convo.chatHint') },
        { value: 'terminal', label: t('chat.convo.terminal'), icon: 'terminal', hint: t('chat.convo.terminalHint'), ...(shortcutKeys('conv-terminal') ? { keys: shortcutKeys('conv-terminal')! } : {}) },
        { value: 'both', label: t('chat.convo.both'), icon: 'columns', hint: t('chat.convo.bothHint') },
      ]}
    />
  );
}
