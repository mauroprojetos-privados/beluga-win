import { Button } from '../components/ui.js';
import { lastCheckedLabel, modeOf, statusLine, switchesOf } from '../lib/update-model.js';
import { checkForUpdates, openUpdateSheet, setUpdateMode, useUpdates } from '../lib/updates.js';
import { Group, Row, Switch } from './settings-controls.js';
import { t } from '@beluga/shared/i18n/index.js';
import { say, useT } from '../lib/i18n.js';

const AUTO_DETAIL = () => ({
  on: t('prefs.updates.autoOn'),
  off: t('prefs.updates.autoOff'),
});
const CHECK_DETAIL = () => ({
  on: t('prefs.updates.checkOn'),
  off: t('prefs.updates.checkOff'),
});

/** Check Now, and what's happening (or when Beluga last looked). */
function CheckRow({ label }: { label: string }) {
  const t = useT();
  const { state } = useUpdates();
  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing';
  const status = statusLine(state);
  return (
    <Row label={label} detail={t('prefs.updates.lastChecked', { status: status ? t('prefs.updates.status', { status }) : '', when: lastCheckedLabel(state.lastCheck) })}>
      {state.available ? (
        <Button size="small" onClick={openUpdateSheet}>
          {t('prefs.updates.showUpdate')}
        </Button>
      ) : null}
      <Button size="small" onClick={() => void checkForUpdates()} disabled={busy}>
        {t('prefs.updates.checkNow')}
      </Button>
    </Row>
  );
}

/** Settings › General › Updates. */
export function UpdateSettingsGroup() {
  const t = useT();
  const { state } = useUpdates();
  const on = switchesOf(state.mode);
  return (
    <Group title={say('Updates')}>
      <Row label={say('Update automatically')} detail={on.auto ? AUTO_DETAIL().on : AUTO_DETAIL().off}>
        <Switch label={say('Update automatically')} on={on.auto} onChange={(auto) => void setUpdateMode(modeOf({ auto }, state.mode))} />
      </Row>
      <Row label={say('Check for updates')} detail={on.check ? CHECK_DETAIL().on : CHECK_DETAIL().off}>
        <Switch label={say('Check for updates')} on={on.check} onChange={(check) => void setUpdateMode(modeOf({ check }, state.mode))} />
      </Row>
      <CheckRow label={t('prefs.updates.version', { version: state.current })} />
    </Group>
  );
}

/** Settings › About: the same Check Now. */
export function UpdateAboutRow() {
  useT();
  return <CheckRow label={say('Updates')} />;
}
