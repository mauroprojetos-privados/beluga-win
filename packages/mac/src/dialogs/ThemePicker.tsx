import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useDocTheme } from '../components/markdown/use-doc-theme.js';
import { ACCENTS, type UiPrefs, pickTheme, useChosenPrefs } from '../lib/prefs.js';
import { type AppTheme, type ThemeBase, THEMES, themeFor } from '../lib/themes.js';
import { Group } from './settings-controls.js';
import tm from './themes.module.css';
import { say } from '../lib/i18n.js';

/** The accent a theme shows with your Accent: its own while that's System or Theme, else yours. */
const accentFor = (theme: AppTheme, accent: UiPrefs['accent']): string => (accent === 'system' || accent === 'theme' ? (theme.accent ?? 'AccentColor') : ACCENTS[accent]);

/** A theme as a little Beluga window: the sidebar with a picked row, a message, Claude's answer and the four states. */
function ThemeCard({ theme, on, accent }: { readonly theme: AppTheme; readonly on: boolean; readonly accent: string }) {
  const k = theme.colors;
  const vars = { '--p-bg': k.bg, '--p-side': k.sidebar, '--p-raised': k.raised, '--p-text': k.text, '--p-text2': k.text2, '--p-text3': k.text3, '--p-accent': accent, '--p-claude': k.claude, '--p-line': theme.base === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' } as CSSProperties;
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={theme.name} className={cx(tm.card, on && tm.cardOn)} onClick={() => pickTheme(theme.id)}>
      <span className={cx(tm.window, theme.lit && tm.lit)} style={vars} aria-hidden>
        <span className={tm.side}>
          <i className={tm.sideRow} />
          <i className={cx(tm.sideRow, tm.sideOn)} />
          <i className={tm.sideRow} />
          <i className={tm.sideRow} />
        </span>
        <span className={tm.main}>
          <span className={tm.mine}>
            <i style={{ width: '62%' }} />
          </span>
          <span className={tm.answer}>
            <b />
            <span>
              <i style={{ width: '88%' }} />
              <i className={tm.dim} style={{ width: '64%' }} />
            </span>
          </span>
          <span className={tm.states}>
            {[k.ok, k.warn, k.error, k.info].map((color) => (
              <i key={color} style={{ background: color }} />
            ))}
            <em />
          </span>
        </span>
      </span>
      <span className={tm.name}>
        {theme.name}
        {on ? <Icon name="check" size={12} /> : null}
      </span>
    </button>
  );
}

function ThemeGrid({ base, prefs }: { readonly base: ThemeBase; readonly prefs: UiPrefs }) {
  const picked = themeFor(base, prefs).id;
  const list = THEMES.filter((th) => th.base === base);
  return (
    <div className={tm.grid} role="radiogroup" aria-label={base === 'dark' ? say('Dark theme') : say('Light theme')}>
      {list.map((th) => (
        <ThemeCard key={th.id} theme={th} on={th.id === picked} accent={accentFor(th, prefs.accent)} />
      ))}
    </div>
  );
}

/**
 * The window's themes (BLG-696), one for dark and one for light: Match the System switches between
 * them. The one showing now comes first; picking one from the other shows it at once.
 */
export function ThemeGroups() {
  const prefs = useChosenPrefs();
  const showing = useDocTheme();
  const order: readonly ThemeBase[] = showing === 'dark' ? ['dark', 'light'] : ['light', 'dark'];
  return (
    <>
      {order.map((base) => (
        <Group key={base} title={base === 'dark' ? say('Dark theme') : say('Light theme')}>
          <ThemeGrid base={base} prefs={prefs} />
        </Group>
      ))}
    </>
  );
}
