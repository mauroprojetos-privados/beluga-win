import { useEffect, useState } from 'react';
import { AUTO_COMPACT_MAX, AUTO_COMPACT_MIN, AUTO_COMPACT_TOKENS_DEFAULT, formatTokenCount, thresholdPct } from '@beluga/shared/context-usage.js';
import { useApi, useApp } from '../lib/beluga.js';
import { say, useT } from '../lib/i18n.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';

/** The token thresholds Settings offers (docs/compaction.md); unset: 160k on a 1M window, the percent on 200k. */
const TOKEN_CHOICES = [80_000, 120_000, 160_000, 200_000, 300_000, 500_000] as const;

/**
 * Settings › Claude › Context: the meter, and compacting on its own when a conversation is nearly
 * full (Claude summarizes its working memory and keeps going; the chat stays on screen). The
 * threshold is a percent of the window, or tokens too: whichever comes first.
 */
export function ContextSettings() {
  const t = useT();
  const api = useApi();
  const p = useApp((st) => st.prefs);
  const saved = thresholdPct(p.autoCompactAt);
  const tokens = typeof p.autoCompactAt === 'object' ? p.autoCompactAt.tokens : undefined;
  // The slider moves freely; the setting is saved when you let go.
  const [at, setAt] = useState(saved);
  useEffect(() => setAt(saved), [saved]);
  const commit = (): void => {
    if (at !== saved) void api.session.setPrefs({ autoCompactAt: tokens ? { tokens, pct: at } : at });
  };
  const pickTokens = (value: string): void => {
    const n = Number(value);
    void api.session.setPrefs({ autoCompactAt: n > 0 ? { tokens: n, pct: saved } : saved });
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
      <Row label={t('prefs.context.atTokens')} detail={t('prefs.context.atTokensDetail', { tokens: formatTokenCount(tokens ?? AUTO_COMPACT_TOKENS_DEFAULT) })}>
        <Select
          label={t('prefs.context.atTokens')}
          value={String(tokens ?? 0)}
          disabled={!p.autoCompact}
          onChange={pickTokens}
          options={[{ value: '0', label: t('prefs.context.tokensDefault') }, ...TOKEN_CHOICES.map((n) => ({ value: String(n), label: formatTokenCount(n) }))]}
        />
      </Row>
    </Group>
  );
}
