import { useRef, useState } from 'react';
import { fireVars, SETUPS, setupOf, DEFAULT_FIRE, type FireLook, type FirePalette, PALETTES, PRESETS, paletteOf, presetOf, TIMING } from '../chat/fire-look.js';
import { MaxFire } from '../chat/MaxFire.js';
import { Icon } from '../components/Icon.js';
import { Button, Segmented, cx } from '../components/ui.js';
import { say, useT } from '../lib/i18n.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { Group, Row, Switch } from './settings-controls.js';
import f from './fire-settings.module.css';
import m from '../chat/max.module.css';
import s from './settings.module.css';

/** The dials, in plain words at each end. */
const DIALS = () =>
  [
    { key: 'fuel', label: say('Fuel'), low: say('A few flames'), high: say('A wall of fire') },
    { key: 'height', label: say('Height'), low: say('Low'), high: say('Towering') },
    { key: 'thickness', label: say('Thickness'), low: say('Wispy'), high: say('Thick') },
    { key: 'wildness', label: say('Wildness'), low: say('Calm'), high: say('Wild') },
  ] as const;

/** Only while typing: how soon it catches and goes out (and the seconds it is). */
const TIMES = () =>
  [
    { key: 'catchAfter', label: say('Catches'), low: say('At once'), high: say('After a while') },
    { key: 'outAfter', label: say('Goes out'), low: say('At once'), high: say('Lingers') },
  ] as const;

/** A slider with a word at each end, its track filled in the fire's colours (and, `shown`, its value at the end). */
export function Dial({ label, low, high, value, min = 0, max = 1, step = 0.05, colors, shown, onChange }: { label: string; low: string; high: string; value: number; min?: number; max?: number; step?: number; colors: readonly string[]; shown?: string; onChange: (v: number) => void }) {
  return (
    <div className={cx(f.dial, shown !== undefined && f.shown)}>
      <span className={f.dialLabel}>{label}</span>
      <span className={f.end}>{low}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        className={f.range}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%`, '--c0': colors[0], '--c1': colors[1] } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={f.end}>{high}</span>
      {shown !== undefined ? <span className={f.value}>{shown}</span> : null}
    </div>
  );
}

/** Three dots in a palette's colours, edge to core. */
function Dots({ colors }: { colors: readonly string[] }) {
  return (
    <span className={f.dots}>
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** A little flame in a palette's colours (the presets' and palettes' picture). */
function Swatch({ colors }: { colors: readonly string[] }) {
  return (
    <svg className={f.swatch} viewBox="0 0 24 30" aria-hidden>
      <path d="M12 1C14 8 22 12 22 20a10 10 0 0 1-20 0C2 14 7 11 8 5c2 3 3 5 3 7 2-3 2-7 1-11z" fill={colors[0]} />
      <path d="M12 9c1 4 6 7 6 12a6 6 0 0 1-12 0c0-3 2-5 3-8 1 2 1 3 1 4 2-2 2-5 2-8z" fill={colors[1]} />
      <path d="M12 17c1 2 3 3 3 5a3 3 0 0 1-6 0c0-2 2-3 3-5z" fill={colors[2]} />
    </svg>
  );
}

/**
 * Settings › Fire & Confetti: the message box's effects (on Max effort by default, or everywhere). A preset sets everything; the
 * sliders, colours and switches fine-tune it. The preview at the top burns as you change it: type
 * or delete there to try it.
 */
export function FireSettings() {
  const t = useT();
  const look = usePrefs().maxFire;
  const set = (patch: Partial<FireLook>): void => {
    const next = { ...look, ...patch };
    setPrefs({ maxFire: { ...next, preset: presetOf(next) } });
  };
  const colors = paletteOf(look).colors;
  return (
    <>
      <Preview look={look} />
      <Group title={say('What’s on')}>
        <div className={f.presets} role="radiogroup" aria-label={say('What’s on')}>
          {SETUPS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={setupOf(look) === x.id} className={cx(f.preset, setupOf(look) === x.id && f.on)} onClick={() => set(x.set)}>
              <span className={f.presetName}>{x.name}</span>
              <span className={f.presetBlurb}>{x.blurb}</span>
            </button>
          ))}
        </div>
        <Row label={say('Where')} detail={look.where === 'max' ? t('prefs.fire.whereMax') : t('prefs.fire.whereAll')}>
          <Segmented
            label={say('Where')}
            radio
            value={look.where}
            onChange={(where) => set({ where })}
            options={[
              { value: 'max', label: t('prefs.fire.onMaxOnly') },
              { value: 'everywhere', label: t('prefs.fire.everywhere') },
            ]}
          />
        </Row>
      </Group>
      <Group title={say('Start from')}>
        <div className={f.presets} role="radiogroup" aria-label={t('prefs.fire.presets')}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={look.preset === p.id} className={cx(f.preset, look.preset === p.id && f.on)} onClick={() => set(p.look)}>
              <Swatch colors={paletteOf({ palette: p.look.palette, palettes: look.palettes }).colors} />
              <span className={f.presetName}>{p.name}</span>
              <span className={f.presetBlurb}>{p.blurb}</span>
            </button>
          ))}
          {look.preset === 'custom' ? (
            <div className={cx(f.preset, f.on)} role="radio" aria-checked>
              <Swatch colors={colors} />
              <span className={f.presetName}>{t('prefs.fire.yourOwn')}</span>
              <span className={f.presetBlurb}>{t('prefs.fire.tunedByYou')}</span>
            </div>
          ) : null}
        </div>
      </Group>
      <Group title={say('When and how')}>
        <Row label={say('When it burns')}>
          <Segmented
            label={say('When it burns')}
            radio
            value={look.show}
            onChange={(show) => set({ show })}
            options={[
              { value: 'always', label: t('prefs.fire.always') },
              { value: 'typing', label: t('prefs.fire.whileTypingOption') },
              { value: 'off', label: t('prefs.fire.never') },
            ]}
          />
        </Row>
        <Row label={say('Color the box')} detail={look.border ? t('prefs.fire.borderOn') : t('prefs.fire.borderOff')}>
          <Switch label={say('Color the box')} on={look.border} onChange={(border) => set({ border })} />
        </Row>
        <Row label={say('Style')}>
          <Segmented
            label={say('Style')}
            radio
            value={look.style}
            onChange={(style) => set({ style })}
            options={[
              { value: 'toon', label: t('prefs.fire.flame') },
              { value: 'pixel', label: t('prefs.fire.pixelArt') },
            ]}
          />
        </Row>
      </Group>
      {look.show === 'typing' ? (
        <Group title={say('While typing')}>
          {TIMES().map((d) => (
            <Dial key={d.key} label={d.label} low={d.low} high={d.high} {...TIMING[d.key]} value={look[d.key]} colors={colors} shown={t('prefs.fire.seconds', { seconds: Number(look[d.key].toFixed(1)) })} onChange={(v) => set({ [d.key]: v })} />
          ))}
        </Group>
      ) : null}
      <Group title={say('The flames')}>
        {DIALS().map((d) => (
          <Dial key={d.key} label={d.label} low={d.low} high={d.high} value={look[d.key]} colors={colors} onChange={(v) => set({ [d.key]: v })} />
        ))}
      </Group>
      <Colors look={look} set={set} />
      <Group title={say('Extras')}>
        <Row label={say('Flare when you type fast')} detail={t('prefs.fire.flareDetail')}>
          <Switch label={say('Flare when you type fast')} on={look.temper} onChange={(temper) => set({ temper })} />
        </Row>
        <Row label={say('As you type')} detail={t('prefs.fire.asYouTypeDetail')}>
          <Segmented
            label={say('As you type')}
            radio
            value={look.typing}
            onChange={(typing) => set({ typing })}
            options={[
              { value: 'off', label: t('prefs.fire.nothing') },
              { value: 'confetti', label: t('prefs.fire.confetti') },
              { value: 'pixels', label: t('prefs.fire.pixels') },
            ]}
          />
        </Row>
        <Row label={say('Deleting pops into pixels')} detail={t('prefs.fire.popDeleteDetail')}>
          <Switch label={say('Deleting pops into pixels')} on={look.popDelete} onChange={(popDelete) => set({ popDelete })} />
        </Row>
      </Group>
      {(['preset', 'show', 'where', 'typing', 'popDelete', 'catchAfter', 'outAfter'] as const).some((k) => look[k] !== DEFAULT_FIRE[k]) ? (
        <div className={f.reset}>
          <Button size="small" onClick={() => setPrefs({ maxFire: { ...DEFAULT_FIRE, palettes: look.palettes } })}>
            {t('prefs.fire.backToDefault')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** A box like the message box, burning with these settings: type or delete in it to try them (`className` replaces the stage's own look; the welcome's Fire step has its own). */
export function Preview({ look, className }: { look: FireLook; className?: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  // As it will be: no flames when the fire is off (the pixels and confetti still fly).
  return (
    <div className={className ?? f.stage} style={{ paddingTop: 200 }}>
      <div ref={box} data-fire={look.show} className={cx(f.fakeBox, look.show !== 'off' && look.border ? m.max : cx(f.plainBox, m.maxPlain))} style={fireVars(look) as React.CSSProperties}>
        <MaxFire box={box} input={input} look={look} />
        <textarea ref={input} className={f.fakeInput} rows={2} value={text} placeholder={t('prefs.fire.tryPlaceholder')} aria-label={t('prefs.fire.tryAria')} onChange={(e) => setText(e.target.value)} />
      </div>
    </div>
  );
}

/** The palettes: Beluga's and yours (named by you), and a maker for new ones. */
function Colors({ look, set }: { look: FireLook; set: (patch: Partial<FireLook>) => void }) {
  const t = useT();
  const [making, setMaking] = useState<FirePalette | undefined>();
  const mine = look.palettes;
  const save = (p: FirePalette): void => {
    const name = p.name.trim() || t('prefs.fire.myColors');
    const palettes = mine.some((x) => x.id === p.id) ? mine.map((x) => (x.id === p.id ? { ...p, name } : x)) : [...mine, { ...p, name }];
    set({ palettes, palette: p.id });
    setMaking(undefined);
  };
  const remove = (id: string): void => {
    set({ palettes: mine.filter((x) => x.id !== id), ...(look.palette === id ? { palette: 'blue' } : {}) });
    setMaking(undefined);
  };
  return (
    <Group title={say('Colors')}>
      <div className={f.palettes} role="radiogroup" aria-label={t('prefs.fire.fireColors')}>
        {[...PALETTES, ...mine].map((p) => {
          const own = mine.includes(p);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={look.palette === p.id}
              className={cx(f.palette, look.palette === p.id && f.on)}
              onClick={() => set({ palette: p.id })}
              onDoubleClick={() => own && setMaking(p)}
              title={own ? t('prefs.fire.doubleClick') : undefined}
            >
              <Dots colors={p.colors} />
              {p.name}
              {own && look.palette === p.id ? (
                <span
                  className={f.edit}
                  role="button"
                  tabIndex={0}
                  aria-label={t('prefs.fire.change', { name: p.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMaking(p);
                  }}
                >
                  <Icon name="pencil" size={10} />
                </span>
              ) : null}
            </button>
          );
        })}
        <button type="button" className={cx(f.palette, f.add)} onClick={() => setMaking({ id: `own-${Date.now().toString(36)}`, name: '', colors: [...paletteOf(look).colors] as [string, string, string] })}>
          <Icon name="plus" size={11} />
          {t('prefs.fire.newColors')}
        </button>
      </div>
      {making ? <Maker palette={making} isNew={!mine.some((x) => x.id === making.id)} onSave={save} onCancel={() => setMaking(undefined)} onDelete={() => remove(making.id)} /> : null}
    </Group>
  );
}

/** Three round wells (edge, middle, core) and a name. */
function Maker({ palette, isNew, onSave, onCancel, onDelete }: { palette: FirePalette; isNew: boolean; onSave: (p: FirePalette) => void; onCancel: () => void; onDelete: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(palette);
  const well = (i: 0 | 1 | 2, label: string) => (
    <label className={f.well}>
      <span className={f.wellDot} style={{ background: draft.colors[i] }}>
        <input
          type="color"
          aria-label={label}
          value={draft.colors[i]}
          onChange={(e) => {
            const colors = [...draft.colors] as [string, string, string];
            colors[i] = e.target.value;
            setDraft({ ...draft, colors });
          }}
        />
      </span>
      {label}
    </label>
  );
  return (
    <form
      className={f.maker}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <Swatch colors={draft.colors} />
      {well(0, t('prefs.fire.edge'))}
      {well(1, t('prefs.fire.middle'))}
      {well(2, t('prefs.fire.core'))}
      <input className={cx(s.text, f.name)} placeholder={t('prefs.fire.namePlaceholder')} aria-label={t('prefs.fire.name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
      <span className={f.makerButtons}>
        {isNew ? null : (
          <Button size="small" variant="quiet" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
        <Button size="small" variant="quiet" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="small" variant="primary" type="submit">
          {isNew ? t('prefs.fire.add') : t('common.save')}
        </Button>
      </span>
    </form>
  );
}
