import { useEffect, useState } from 'react';
import { parseSkillNames } from '@beluga/shared/run-skills.js';
import { cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import { Group, Row, Select } from './settings-controls.js';
import s from './settings.module.css';
import ts from './terminal-settings.module.css';

/**
 * Settings › Agent › Skills (shared/run-skills.ts, docs/routing.md "Skills per project"): every skill
 * your Claude Code has, or only the ones named. Each skill listed costs context on every turn; a
 * project's beluga.json and a bot's bot.json can set their own list, which wins over this one.
 */
export function SkillsSettings() {
  const t = useT();
  const api = useApi();
  const saved = useApp((st) => st.prefs.skills);
  const only = Array.isArray(saved);
  const savedText = only ? saved.join(', ') : '';
  const [text, setText] = useState(savedText);
  useEffect(() => setText(savedText), [savedText]);
  const { names, bad } = parseSkillNames(text);
  const save = (): void => {
    if (!bad.length && names.join(', ') !== savedText) void api.session.setPrefs({ skills: names });
  };
  return (
    <Group title={t('prefs.skills.title')}>
      <Row label={t('prefs.skills.which')} detail={t('prefs.skills.whichDetail')}>
        <Select
          label={t('prefs.skills.which')}
          value={only ? 'only' : 'all'}
          onChange={(v) => void api.session.setPrefs({ skills: v === 'only' ? names : null })}
          options={[
            { value: 'all', label: t('prefs.skills.all'), description: t('prefs.skills.allDetail') },
            { value: 'only', label: t('prefs.skills.only'), description: t('prefs.skills.onlyDetail') },
          ]}
        />
      </Row>
      {only ? (
        <Row label={t('prefs.skills.names')} detail={bad.length ? t('prefs.skills.bad', { names: bad.join(', ') }) : t('prefs.skills.namesDetail')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {/* i18n-ignore */}
            <input className={cx(s.text, ts.mono)} aria-label={t('prefs.skills.names')} aria-invalid={bad.length > 0} value={text} placeholder="pdf, docx" spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={save} />
          </form>
        </Row>
      ) : null}
    </Group>
  );
}
