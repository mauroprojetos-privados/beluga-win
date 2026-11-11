import { useEffect, useState } from 'react';
import { AUTO_COMPACT_MAX, AUTO_COMPACT_MIN, clampThreshold } from '@beluga/shared/context-usage.js';
import { useApi, useApp } from '../lib/beluga.js';
import { say, useT } from '../lib/i18n.js';
import { Group, Row, Switch } from './settings-controls.js';
import s from './settings.module.css';

/**
 * Settings › Claude › Context: the meter, and compacting on its own when a conversation is nearly
 * full (Claude summarizes its working memory and keeps going; the chat stays on screen).
 */
export function ContextSettings() {
  const t = useT();
  const api = useApi();
  const p = useApp((st) => st.prefs);
  const saved = clampThreshold(p.autoCompactAt);
  // The slider moves freely; the setting is saved when you let go.
  const [at, setAt] = useState(saved);
  useEffect(() => setAt(saved), [saved]);
  const commit = (): void => {
    if (at !== saved) void api.session.setPrefs({ autoCompactAt: at });
  };
  return (
    <Group title={say('Context')}>
      <Row label={say('Context meter')} detail={t('prefs.context.meterDetail')}>
        <Switch label={say('Context meter')} on={p.contextMeter} onChange={(v) => void api.session.setPrefs({ contextMeter: v })} />
      </Row>
      <Row
        label={say('Auto-compact when the context is nearly full')}
        detail={p.autoCompact ? t('prefs.context.autoOn') : t('prefs.context.autoOff')}
      >
        <Switch label={t('prefs.context.autoSwitch')} on={p.autoCompact} onChange={(v) => void api.session.setPrefs({ autoCompact: v })} />
      </Row>
      <Row label={say('Compact at')} detail={t('prefs.context.atDetail', { percent: at })}>
        <input
          className={s.slider}
          type="range"
          aria-label={say('Compact at')}
          min={AUTO_COMPACT_MIN}
          max={AUTO_COMPACT_MAX}
          step={1}
          value={at}
          disabled={!p.autoCompact}
          onChange={(e) => setAt(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </Row>
    </Group>
  );
}
