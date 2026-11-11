import type { TermColors } from '../../../../src/terminal/import/look.js';
import { Icon } from '../components/Icon.js';
import { Button, Segmented, cx } from '../components/ui.js';
import { termKeyRows, termKeysOf } from '../lib/term-keys.js';
import { colorsFor } from '../lib/terminal-import-model.js';
import type { TermThemePref } from '../lib/terminal-import-model.js';
import { fontStack, looksDark } from '../lib/terminal-look.js';
import { PRESET_FROM, TERMINAL_PRESETS } from '../lib/terminal-themes.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { Group, Row, Switch } from './settings-controls.js';
import tc from './terminal-settings.module.css';
import { chordLabel } from '../lib/shortcuts-model.js';
import { say, useT } from '../lib/i18n.js';

/** A theme's look in a few lines of a terminal, its own colours (Beluga's when it has none). */
function ThemeCard({ name, colors, on, onPick, font }: { readonly name: string; readonly colors: TermColors | undefined; readonly on: boolean; readonly onPick: () => void; readonly font: string }) {
  const a = (i: number): string | undefined => colors?.ansi[i] ?? undefined;
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={name} className={cx(tc.themeCard, on && tc.themeCardOn)} onClick={onPick}>
      <span className={tc.themeLines} style={{ fontFamily: fontStack(font), ...(colors?.background ? { background: colors.background } : {}), ...(colors?.foreground ? { color: colors.foreground } : {}) }}>
        <span>
          {/* i18n-ignore: a sample of a terminal's output */}
          <span style={{ color: a(2) ?? 'var(--ok)' }}>⏺</span> Read(auth.ts)
        </span>
        {/* i18n-ignore */}
        <span style={{ opacity: 0.55 }}>{'  ⎿ 214 lines'}</span>
        <span>
          {/* i18n-ignore: a sample of a terminal's output */}
          <span style={{ color: a(4) ?? 'var(--info)' }}>{'>'}</span> fix the <span style={{ color: a(1) ?? 'var(--error)' }}>failing</span> test
        </span>
        {/* i18n-ignore */}
        <span style={{ color: a(3) ?? 'var(--warn)' }}>✻ Thinking…</span>
      </span>
      <span className={tc.themeName}>
        {name}
        {on ? <Icon name="check" size={12} /> : null}
        <span className={tc.themeDots} aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ background: a(i) ?? 'var(--hairline-strong)' }} />
          ))}
        </span>
      </span>
    </button>
  );
}

/**
 * The terminal's colours (BLG-536): Beluga's own, a theme you brought from another terminal, or a
 * well-known one. Each shows as it will look; one with light colours follows Beluga's appearance.
 */
export function ThemeGroup() {
  const t = useT();
  const prefs = usePrefs();
  const dark = looksDark();
  const current = prefs.termTheme;
  const imported = current && current.from !== PRESET_FROM ? current : undefined;
  const pick = (theme: TermThemePref | null): void => setPrefs({ termTheme: theme });
  return (
    <Group title={say('Colours')}>
      <div className={tc.themes} role="radiogroup" aria-label={t('prefs.terminal.terminalColours')}>
        <ThemeCard name="Beluga" /* i18n-ignore */ colors={undefined} font={prefs.termFont} on={!current} onPick={() => pick(null)} />
        {imported ? <ThemeCard name={imported.name} colors={colorsFor(imported, dark)} font={prefs.termFont} on onPick={() => pick(imported)} /> : null}
        {TERMINAL_PRESETS.map((p) => (
          <ThemeCard key={p.name} name={p.name} colors={colorsFor(p, dark)} font={prefs.termFont} on={current?.from === PRESET_FROM && current.name === p.name} onPick={() => pick(p)} />
        ))}
      </div>
    </Group>
  );
}

/**
 * The terminal view (BLG-534), for people who'd rather talk to Claude in Claude Code's own
 * terminal app: off by default (everyone has the chat); on, each conversation's header can show it
 * as the chat, the terminal, or both, and this picks how ones you haven't switched open.
 */
export function ViewGroup() {
  const t = useT();
  const prefs = usePrefs();
  return (
    <Group title={say('Advanced')}>
      <Row label={say('Use Claude Code’s own terminal')} detail={prefs.termView ? t('prefs.terminal.ownTerminalOn', { keys: chordLabel('Shift+Cmd+T') }) : t('prefs.terminal.ownTerminalOff')}>
        <Switch label={t('prefs.terminal.ownTerminal')} on={prefs.termView} onChange={(v) => setPrefs({ termView: v })} />
      </Row>
      {prefs.termView ? <Row label={say('Open conversations as')} detail={prefs.convoDefault === 'chat' ? t('prefs.terminal.openAsChat') : prefs.convoDefault === 'terminal' ? t('prefs.terminal.openAsTerminal') : t('prefs.terminal.openAsBoth')}>
        <Segmented
          label={t('prefs.terminal.openAs')}
          value={prefs.convoDefault}
          onChange={(v) => setPrefs({ convoDefault: v, convoDefaultPicked: true })}
          options={[
            { value: 'chat', label: t('prefs.terminal.chat'), icon: 'chat' },
            { value: 'terminal', label: t('prefs.terminal.terminal'), icon: 'terminal' },
            { value: 'both', label: t('prefs.terminal.both'), icon: 'columns' },
          ]}
        />
      </Row> : null}
    </Group>
  );
}

/**
 * The terminal's keys (BLG-537): what each does, the ones you brought from your terminal marked,
 * and whether they win over Beluga's shortcuts while the keyboard is in the terminal.
 */
export function KeysGroup() {
  const t = useT();
  const prefs = usePrefs();
  const rows = termKeyRows(termKeysOf(prefs.termKeys?.keys, prefs.termKeys?.from));
  return (
    <Group title={say('Keys in the terminal view')}>
      <Row label={say('The terminal’s keys come first')} detail={prefs.termKeysFirst ? t('prefs.terminal.keysFirstOn', { keys: ['Cmd+T', 'Cmd+W', 'Cmd+1'].map(chordLabel).join(', ') }) : t('prefs.terminal.keysFirstOff')}>
        <Switch label={t('prefs.terminal.keysFirst')} on={prefs.termKeysFirst} onChange={(v) => setPrefs({ termKeysFirst: v })} />
      </Row>
      <div className={tc.keyList} role="list" aria-label={t('prefs.terminal.terminalKeys')}>
        {rows.map((r) => (
          <div key={r.label} className={tc.keyRow} role="listitem">
            <span>{r.label}</span>
            {r.from ? <span className={tc.keyFrom}>{t('prefs.terminal.keyFrom', { from: r.from })}</span> : null}
            <span className={tc.keyKeys}>{r.keys}</span>
          </div>
        ))}
      </div>
      {prefs.termKeys?.keys.length ? (
        <Row label={t('prefs.terminal.keysFrom', { count: prefs.termKeys.keys.length, from: prefs.termKeys.from || t('prefs.terminal.yourTerminal') })} detail={t('prefs.terminal.keysBrought')}>
          <Button size="small" onClick={() => setPrefs({ termKeys: null })}>
            {t('prefs.terminal.useBelugaKeys')}
          </Button>
        </Row>
      ) : null}
    </Group>
  );
}
