import { useEffect, useState } from 'react';
import { PARALLEL_RUNS_MAX, PARALLEL_RUNS_MIN, clampParallelRuns } from '@beluga/shared/run-slots.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';
import { say, useT } from '../lib/i18n.js';

/**
 * Settings › Claude › Working at once: how many conversations your Claude works in at the same
 * time. A message past it waits for one to finish, and its card says so.
 */
export function ParallelSettings() {
  const t = useT();
  const api = useApi();
  const saved = clampParallelRuns(useApp((st) => st.prefs.parallelRuns));
  // The slider moves freely; the setting is saved when you let go.
  const [n, setN] = useState(saved);
  useEffect(() => setN(saved), [saved]);
  const commit = (): void => {
    if (n !== saved) void api.session.setPrefs({ parallelRuns: n });
  };
  return (
    <Group title={say('Working at once')}>
      <Row
        label={say('Conversations your agent works in at once')}
        detail={t('prefs.parallel.detail', { n })}
      >
        <span className={s.sliderEnds}>
          <span>{t('prefs.parallel.fewer')}</span>
          <input
            className={s.slider}
            type="range"
            aria-label={t('prefs.parallel.slider')}
            min={PARALLEL_RUNS_MIN}
            max={PARALLEL_RUNS_MAX}
            step={1}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <span>{t('prefs.parallel.more')}</span>
        </span>
      </Row>
    </Group>
  );
}
