import type { NotifySettings } from '@beluga/shared/settings-schema.js';
import { DND_CHOICES, type DndChoice, dndActive, dndFor, dndWords } from '@beluga/shared/quiet.js';
import { Button } from '../components/ui.js';
import { previewRequestPopup } from '../gateway/request-native.js';
import { useApi, useApp } from '../lib/beluga.js';
import { runAccessAction, useNotificationAccess } from '../lib/sounds/access.js';
import { type AccessAction, notifyStatus } from '../lib/sounds/access-model.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import { NotifyStatusLine } from './sound/NotifyStatus.js';
import { SoundSettings } from './sound/SoundSettings.js';
import { TestNotification } from './sound/TestNotification.js';
import { keyPlatform } from '../lib/shortcuts-model.js';
import { t } from '@beluga/shared/i18n/index.js';
import { say, useT } from '../lib/i18n.js';

type Toggle = 'desktop' | 'onlyAway' | 'planMilestones' | 'needsYou' | 'done' | 'doneHere' | 'mentions' | 'people' | 'background' | 'sentinels' | 'problems' | 'pr';

const KINDS = (): ReadonlyArray<readonly [Toggle, string, string]> => [
  ['needsYou', say('Your agent needs you'), t('prefs.notify.needsYouDetail')],
  ['done', say('Your agent finished'), t('prefs.notify.doneDetail')],
  ['doneHere', say('Your agent finished where I’m looking'), t('prefs.notify.doneHereDetail')],
  ['mentions', say('Mentions and messages'), t('prefs.notify.mentionsDetail')],
  ['people', say('People come and go'), t('prefs.notify.peopleDetail')],
  ['background', say('Background tasks'), t('prefs.notify.backgroundDetail')],
  ['sentinels', say('Sentinels'), t('prefs.notify.sentinelsDetail')],
  ['problems', say('Problems'), t('prefs.notify.problemsDetail')],
  ['pr', say('Pull requests'), t('prefs.notify.prDetail')],
  ['planMilestones', say('Plans: milestones only'), t('prefs.notify.milestonesDetail')],
];

/**
 * Settings › Notifications: whether they reach you (and how to fix it when macOS is in the
 * way), the sound with a test right under it, and what reaches you when.
 */
export function NotificationSettings() {
  const t = useT();
  const api = useApi();
  const n = useApp((st) => st.prefs.notify);
  const save = (patch: Partial<NotifySettings>): void => void api.session.setPrefs({ notify: { ...n, ...patch } });
  const quiet = dndActive(n);
  const { access, recheck } = useNotificationAccess();
  const status = notifyStatus(access, { desktop: n.desktop, quietUntil: quiet ? dndWords(n) : null }, keyPlatform());
  // Opening System Settings: checked again when you come back (window focus). Asking: right away.
  const act = (action: AccessAction): void => void runAccessAction(action).then((a) => a && recheck(a)).catch(() => undefined);
  return (
    <>
      <NotifyStatusLine status={status} onAction={act} />
      <Group>
        <Row label={say('Desktop notifications')} detail={t('prefs.notify.desktopDetail')}>
          <Switch label={say('Desktop notifications')} on={n.desktop} onChange={(v) => save({ desktop: v })} />
        </Row>
        <Row label={say('Show on-screen popups when something needs me')} detail={t('prefs.notify.popupsDetail')}>
          <Switch label={say('Show on-screen popups when something needs me')} on={n.popup !== false} onChange={(v) => save({ popup: v })} />
        </Row>
        <Row label={say('See the pop-up')} detail={t('prefs.notify.seePopupDetail')}>
          <Button onClick={previewRequestPopup}>{t('prefs.notify.previewPopup')}</Button>
        </Row>
        <Row label={say('Only when Beluga isn’t in front')} detail={t('prefs.notify.onlyAwayDetail')}>
          <Switch label={say('Only when Beluga isn’t in front')} on={n.onlyAway} onChange={(v) => save({ onlyAway: v })} />
        </Row>
      </Group>
      <SoundSettings n={n} save={save} test={<TestNotification n={n} onChecked={recheck} onAction={act} />} />
      <Group>
        <Row label={say('Do Not Disturb')} detail={quiet ? t('prefs.notify.dndOn', { until: dndWords(n) }) : t('prefs.notify.dndDetail')}>
          {quiet ? (
            <Button onClick={() => save({ dnd: null })}>{t('prefs.notify.turnOff')}</Button>
          ) : (
            <Select<'off' | DndChoice>
              label={say('Do Not Disturb')}
              value="off"
              options={[{ value: 'off', label: t('common.off') }, ...DND_CHOICES]}
              onChange={(v) => save({ dnd: v === 'off' ? null : dndFor(v) })}
            />
          )}
        </Row>
      </Group>
      <Group title={say('Tell me when')}>
        {KINDS().map(([key, label, detail]) => (
          <Row key={key} label={label} detail={detail}>
            <Switch label={label} on={n[key]} onChange={(v) => save({ [key]: v })} />
          </Row>
        ))}
      </Group>
    </>
  );
}
