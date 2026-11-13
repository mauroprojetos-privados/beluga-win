import { useEffect, useState } from 'react';
import { joinArgs, shellName, splitArgs } from '@beluga/shared/shells.js';
import { Segmented, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { SCROLLBACK_CHOICES, fontChoices } from '../lib/terminal-look.js';
import { ImportGroup, TermPreview } from './TerminalImport.js';
import { KeysGroup, ThemeGroup, ViewGroup } from './TerminalThemes.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import tc from './terminal-settings.module.css';
import { shortcutKeys } from '../lib/shortcuts.js';
import { thisComputer } from '../lib/os-words.js';
import { keyPlatform, type KeyPlatform } from '../lib/shortcuts-model.js';
import { say, useT } from '../lib/i18n.js';

const OTHER = '__other';

/** A shell's full path as this computer writes one, and an example (Homebrew's fish on a Mac). */
const SHELL_PATH: Readonly<Record<KeyPlatform, { readonly full: RegExp; readonly start: 'prefs.terminal.startSlash' | 'prefs.terminal.startDrive'; readonly example: string }>> = {
  mac: { full: /^\//, start: 'prefs.terminal.startSlash', example: '/opt/homebrew/bin/fish' },
  linux: { full: /^\//, start: 'prefs.terminal.startSlash', example: '/usr/bin/fish' },
  windows: { full: /^([a-z]:[\\/]|\\\\)/i, start: 'prefs.terminal.startDrive', example: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
};

/** Which shell new terminals run, and how it starts (Beluga's setting, not just this window's). */
function ShellGroup() {
  const t = useT();
  const api = useApi();
  const p = useApp((st) => st.prefs);
  const choices = useApp((st) => st.shellChoices);
  const login = choices.find((c) => c.isDefault);
  const listed = !p.shell || choices.some((c) => c.path === p.shell);
  const [other, setOther] = useState(!listed);
  const [path, setPath] = useState(listed ? '' : (p.shell ?? ''));
  const [args, setArgs] = useState(joinArgs(p.shellArgs));
  useEffect(() => {
    setArgs(joinArgs(p.shellArgs));
  }, [p.shellArgs]);
  const picked = other ? OTHER : (p.shell ?? '');
  const shellPath = SHELL_PATH[keyPlatform()];
  const savePath = (): void => {
    const next = path.trim();
    if (next && next !== p.shell) void api.session.setPrefs({ shell: next });
  };
  return (
    <Group title={say('Shell')}>
      <Row label={say('Shell')} detail={other ? t('prefs.terminal.shellFullPath') : picked ? picked : login ? t('prefs.terminal.shellLoginAt', { path: login.path }) : t('prefs.terminal.shellLogin')}>
        <Select
          label={t('prefs.terminal.shell')}
          value={picked}
          onChange={(v) => {
            setOther(v === OTHER);
            // The login shell is "no shell set": null, since JSON drops undefined on the way to the daemon.
            if (v !== OTHER) void api.session.setPrefs({ shell: v || null });
          }}
          options={[
            { value: '', label: login ? t('prefs.terminal.loginShellNamed', { name: login.name }) : t('prefs.terminal.loginShell') },
            ...choices.filter((c) => !c.isDefault || p.shell === c.path).map((c) => ({ value: c.path, label: choices.filter((x) => x.name === c.name).length > 1 ? `${c.name} · ${c.path}` : c.name })),
            { value: OTHER, label: t('prefs.terminal.other') },
          ]}
        />
      </Row>
      {other ? (
        <Row label={say('Path')} detail={path && !shellPath.full.test(path) ? t('prefs.terminal.pathHint', { start: t(shellPath.start), example: shellPath.example }) : path ? t('prefs.terminal.runs', { name: shellName(path) }) : undefined}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              savePath();
            }}
          >
            <input className={cx(s.text, tc.mono)} aria-label={t('prefs.terminal.shellPath')} value={path} placeholder={shellPath.example} spellCheck={false} onChange={(e) => setPath(e.target.value)} onBlur={savePath} />
          </form>
        </Row>
      ) : null}
      <Row label={say('Login shell')} detail={t('prefs.terminal.loginShellDetail')}>
        <Switch label={t('prefs.terminal.loginShell')} on={p.shellLogin} onChange={(v) => void api.session.setPrefs({ shellLogin: v })} />
      </Row>
      <Row label={say('Extra arguments')} detail={t('prefs.terminal.startedAs', { command: [p.shell ? shellName(p.shell) : (login?.name ?? t('prefs.terminal.shellWord')), ...(p.shellLogin ? ['-l'] : []), ...splitArgs(args)].join(' ') })}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            (e.currentTarget.elements[0] as HTMLInputElement).blur();
          }}
        >
          <input className={cx(s.text, tc.mono)} aria-label={t('prefs.terminal.extraArgs')} value={args} placeholder={t('prefs.terminal.none')} spellCheck={false} onChange={(e) => setArgs(e.target.value)} onBlur={() => joinArgs(splitArgs(args)) !== joinArgs(p.shellArgs) && void api.session.setPrefs({ shellArgs: splitArgs(args).slice(0, 20) })} />
        </form>
      </Row>
    </Group>
  );
}

/** How the terminal looks in this window (kept on this computer). */
function LookGroup() {
  const t = useT();
  const prefs = usePrefs();
  return (
    <Group title={t('prefs.terminal.lookOn', { computer: thisComputer() })}>
      <div className={tc.previewRow}>
        <TermPreview prefs={prefs} />
      </div>
      <Row label={say('Font')}>
        <Select label={t('prefs.terminal.fontLabel')} value={prefs.termFont} onChange={(v) => setPrefs({ termFont: v })} options={fontChoices(prefs.termFont)} />
      </Row>
      <Row label={say('Size')} detail={t('prefs.terminal.sizePt', { size: prefs.termFontSize })}>
        <input className={s.slider} aria-label={t('prefs.terminal.fontSize')} type="range" min={9} max={22} step={0.5} value={prefs.termFontSize} onChange={(e) => setPrefs({ termFontSize: Number(e.target.value) })} />
      </Row>
      <Row label={say('Line height')} detail={`${prefs.termLineHeight.toFixed(2)}×`}>
        <input className={s.slider} aria-label={t('prefs.terminal.lineHeightLabel')} type="range" min={1} max={1.6} step={0.02} value={prefs.termLineHeight} onChange={(e) => setPrefs({ termLineHeight: Number(e.target.value) })} />
      </Row>
      <Row label={say('Cursor')}>
        <Segmented
          label={t('prefs.terminal.cursorStyle')}
          value={prefs.termCursor}
          onChange={(v) => setPrefs({ termCursor: v })}
          options={[
            { value: 'block', label: t('prefs.terminal.block') },
            { value: 'bar', label: t('prefs.terminal.bar') },
            { value: 'underline', label: t('prefs.terminal.underline') },
          ]}
        />
      </Row>
      <Row label={say('Blinking cursor')}>
        <Switch label={t('prefs.terminal.blinking')} on={prefs.termCursorBlink} onChange={(v) => setPrefs({ termCursorBlink: v })} />
      </Row>
      <Row label={say('Scrollback')} detail={t('prefs.terminal.scrollbackDetail')}>
        <Select label={t('prefs.terminal.scrollback')} value={String(prefs.termScrollback)} onChange={(v) => setPrefs({ termScrollback: Number(v) })} options={SCROLLBACK_CHOICES.map((n) => ({ value: String(n), label: t('prefs.terminal.lines', { lines: n.toLocaleString() }) }))} />
      </Row>
      {/* Only a Mac's Option key types special characters; Alt is already Meta elsewhere. */}
      {keyPlatform() === 'mac' ? (
        <Row label={say('Option key as Meta')} detail={prefs.termOptionMeta ? t('prefs.terminal.optionMetaOn') : t('prefs.terminal.optionMetaOff')}>
          <Switch label={t('prefs.terminal.optionMeta')} on={prefs.termOptionMeta} onChange={(v) => setPrefs({ termOptionMeta: v })} />
        </Row>
      ) : null}
    </Group>
  );
}

/** Where ⌘J (and Run) show the terminal in this window: the drawer under the chat or the right panel. */
function PlaceGroup() {
  const t = useT();
  const prefs = usePrefs();
  return (
    <Group title={say('In this window')}>
      <Row label={t('prefs.terminal.opensTerminal', { keys: shortcutKeys('toggle-dock') ?? t('prefs.terminal.toggleTerminal') })} detail={prefs.termIn === 'drawer' ? t('prefs.terminal.drawerDetail') : t('prefs.terminal.panelDetail')}>
        <Segmented
          label={t('prefs.terminal.whereOpens')}
          value={prefs.termIn}
          onChange={(v) => setPrefs({ termIn: v, ...(v === 'panel' ? { drawer: false } : {}) })}
          options={[
            { value: 'drawer', label: t('prefs.terminal.drawer'), icon: 'panelBottom' },
            { value: 'panel', label: t('prefs.terminal.panel'), icon: 'panelRight' },
          ]}
        />
      </Row>
    </Group>
  );
}

/** Settings › Terminal: the shell (for every screen), where it opens and how terminals look here. */
export function TerminalSettings() {
  const t = useT();
  const prefs = usePrefs();
  return (
    <>
      <PlaceGroup />
      <ShellGroup />
      <ImportGroup />
      <ThemeGroup />
      <LookGroup />
      <ViewGroup />
      {prefs.termView ? <KeysGroup /> : null}
      <p className={tc.note}>{t('prefs.terminal.note')}</p>
    </>
  );
}
