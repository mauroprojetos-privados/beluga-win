import { ASSISTANT_TITLE } from '@beluga/shared/assistant.js';
import { CHAT_LIMIT_DEFAULT, CHAT_LIMIT_NONE, CHAT_LIMIT_PRESETS } from '@beluga/shared/chat-limit.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row, Select } from './settings-controls.js';
import { say, useT } from '../lib/i18n.js';

const label = (t: ReturnType<typeof useT>, n: number): string => (n === CHAT_LIMIT_NONE ? t('prefs.chatLimit.noLimit') : t('prefs.chatLimit.chats', { n }));

/**
 * Settings › Agent › Open chats: how many chats Your Mac and Sentinel each keep as tabs. Past it a
 * new chat is refused with a note that points here; No limit never refuses.
 */
export function ChatLimitSettings() {
  const t = useT();
  const api = useApi();
  const saved = useApp((st) => st.prefs.chatLimit ?? CHAT_LIMIT_DEFAULT);
  // A number set in settings.json by hand still shows as itself.
  const values = CHAT_LIMIT_PRESETS.some((n) => n === saved) ? [...CHAT_LIMIT_PRESETS] : [...CHAT_LIMIT_PRESETS, saved].sort((a, b) => (a || Infinity) - (b || Infinity));
  return (
    <Group title={say('Open chats')}>
      <Row
        label={say('Chats kept at once')}
        detail={saved === CHAT_LIMIT_NONE ? t('prefs.chatLimit.none', { assistant: ASSISTANT_TITLE }) : t('prefs.chatLimit.upTo', { assistant: ASSISTANT_TITLE, n: saved })}
      >
        <Select
          label={t('prefs.chatLimit.group')}
          value={String(saved)}
          onChange={(v) => void api.session.setPrefs({ chatLimit: Number(v) })}
          options={values.map((n) => ({ value: String(n), label: label(t, n) }))}
        />
      </Row>
    </Group>
  );
}
