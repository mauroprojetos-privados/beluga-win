import { useState } from 'react';
import { Button } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { Group, Row, Select, Switch } from '../dialogs/settings-controls.js';
import { openNet } from './net-sheets.js';
import { errorText, quietly, useNetwork } from './use-net.js';
import { upFirst, yourComputer } from '../lib/os-words.js';
import { say, useT } from '../lib/i18n.js';

/** Settings › People & access: talking with friends directly (the Beluga network), on or off. */
export function NetworkSettings() {
  const t = useT();
  const { client, ui } = useBeluga();
  const net = useNetwork();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const turn = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await quietly(client, client.api.network.setEnabled(on));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const friends = net.friends.length;
  const groups = net.groups.filter((g) => g.active).length;
  const chatClaude = useApp((st) => st.prefs.chatClaude);
  const shareUsage = useApp((st) => st.prefs.shareUsage);
  const readReceipts = useApp((st) => st.prefs.readReceipts);
  return (
    <Group title={say('Friends')}>
      <Row
        label={say('Talk with friends directly')}
        detail={
          error ? (
            <span style={{ color: 'var(--error)' }}>{error}</span>
          ) : busy ? (
            t('network.settings.turningItOn')
          ) : net.enabled ? (
            t('network.settings.onDetail', { computer: upFirst(yourComputer()), friends: t('network.settings.friends', { count: friends }), channels: t('network.settings.channels', { count: groups }) })
          ) : (
            t('network.settings.offDetail')
          )
        }
      >
        <Switch label={say('Talk with friends directly')} on={net.enabled || busy} onChange={(v) => void turn(v)} />
      </Row>
      {net.enabled ? (
        <Row label={say('Add a friend')} detail={t('network.settings.addFriendDetail')}>
          <Button
            onClick={() => {
              ui.patch({ settings: undefined });
              openNet({ kind: 'add_friend' });
            }}
          >
            {t('network.settings.addFriendButton')}
          </Button>
        </Row>
      ) : null}
      {net.enabled ? (
        <Row label={say('Who can ask your agent in chats')} detail={t('network.settings.whoAskDetail')}>
          <Select<'everyone' | 'trusted' | 'off'>
            label={say('Who can ask your agent in chats')}
            value={chatClaude}
            options={[
              { value: 'everyone', label: t('network.settings.friendsInChat') },
              { value: 'trusted', label: t('network.settings.peopleITrust') },
              { value: 'off', label: t('network.settings.onlyMe') },
            ]}
            onChange={(v) => void client.api.session.setPrefs({ chatClaude: v })}
          />
        </Row>
      ) : null}
      {net.enabled ? (
        <Row label={say('Who sees your usage')} detail={t('network.settings.usageDetail')}>
          <Select<'trusted' | 'everyone' | 'off'>
            label={say('Who sees your usage')}
            value={shareUsage}
            options={[
              { value: 'trusted', label: t('network.settings.peopleITrust') },
              { value: 'everyone', label: t('network.settings.allFriends') },
              { value: 'off', label: t('network.settings.noOne') },
            ]}
            onChange={(v) => void client.api.session.setPrefs({ shareUsage: v })}
          />
        </Row>
      ) : null}
      {net.enabled ? (
        <Row label={say('Say when you’ve seen a message')} detail={t('network.settings.seenDetail')}>
          <Switch label={say('Say when you’ve seen a message')} on={readReceipts} onChange={(v) => void client.api.session.setPrefs({ readReceipts: v })} />
        </Row>
      ) : null}
    </Group>
  );
}
