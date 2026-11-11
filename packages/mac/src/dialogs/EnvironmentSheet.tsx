import { FormSheet } from '../components/FormSheet.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { openSettings } from '../lib/native-routes.js';
import { EnvEditor } from './EnvironmentSettings.js';
import e from './env-settings.module.css';
import { thisComputer } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';

/**
 * A project's Environment… (BLG-369): its variables beside its main folder's .env, from the
 * project's ••• menu or its page, without going through Settings. The same editor as
 * Settings › Environment's, for this project.
 */
export function EnvironmentSheet({ projectId, close }: { projectId: string; close: () => void }) {
  const t = useT();
  const { ui } = useBeluga();
  const name = useApp((st) => st.projects.find((p) => p.id === projectId)?.name);
  if (!name) return null;
  return (
    <FormSheet
      title={t('sheets.env.title', { name })}
      icon="lock"
      intro={t('sheets.env.intro', { computer: thisComputer() })}
      submitLabel={t('common.done')}
      hideSubmit
      cancelLabel={t('common.done')}
      width={640}
      onSubmit={close}
      onCancel={close}
      footer={
        <button
          type="button"
          className={e.inlineLink}
          onClick={() => {
            close();
            openSettings(ui, 'environment');
          }}
        >
          {t('sheets.env.everyProject')}
        </button>
      }
    >
      <div className={e.sheetBody}>
        <EnvEditor projectId={projectId} />
      </div>
    </FormSheet>
  );
}
