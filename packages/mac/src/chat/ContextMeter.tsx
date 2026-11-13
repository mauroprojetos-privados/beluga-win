import * as Popover from '@radix-ui/react-popover';
import { useEffect, useMemo, useRef, useState } from 'react';
import { modelLabel, modelOf } from '@beluga/ui/menus.js';
import { clampThreshold, contextWindowFor, formatTokenCount } from '@beluga/shared/context-usage.js';
import { LOCAL_RUNTIME, speedWords } from '@beluga/shared/local-endpoints.js';
import { cx } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { type MeterModel, breakdownRows, meterModel, usageLine, whenText } from './context-model.js';
import { useT } from '../lib/i18n.js';
import s from './context.module.css';

const OPEN_DELAY_MS = 220;
const CLOSE_DELAY_MS = 180;
const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** The ring: how much of the window is used, or a short arc going round while Claude compacts. */
function Ring({ pct, spinning }: { pct: number; spinning: boolean }) {
  const filled = spinning ? 0.28 : Math.max(pct > 0 ? 0.04 : 0, Math.min(1, pct / 100));
  return (
    <svg className={s.ring} width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle className={s.track} cx="8" cy="8" r={R} fill="none" strokeWidth="2" />
      <circle className={s.arc} cx="8" cy="8" r={R} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - filled)} />
    </svg>
  );
}

/** The meter for a conversation (undefined: nothing to show, or the meter is turned off). */
function useMeter(channel: string): MeterModel | undefined {
  const on = useApp((st) => st.prefs.contextMeter);
  const context = useApp((st) => st.context);
  const log = useApp((st) => st.log);
  return useMemo(() => (on ? meterModel({ context, log }, channel) : undefined), [on, context, log, channel]);
}

/**
 * A local or bring-your-own model's conversation (BLG-450): its tokens so far and how fast its
 * last turn wrote. There's no plan behind it, so this is what it shows instead of limits.
 */
function useLocalRun(channel: string): { tokens: number; tps?: number } | undefined {
  return useApp(
    (st) => {
      const ws = channel.startsWith('ws:') ? st.projects.flatMap((p) => p.workspaces).find((w) => w.id === channel.slice(3)) : undefined;
      if (ws?.agent?.runtime !== LOCAL_RUNTIME) return undefined;
      const u = ws.usage;
      return { tokens: u ? u.input + u.output + u.cacheWrite : 0, ...(u?.local?.tps ? { tps: u.local.tps } : {}) };
    },
    (a, b) => a?.tokens === b?.tokens && a?.tps === b?.tps,
  );
}

/** Open on hover (after a beat), stay open while the pointer is over it; a click pins it. */
function useHoverOpen(): { open: boolean; setOpen: (v: boolean) => void; hover: { onPointerEnter: () => void; onPointerLeave: () => void } } {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const later = (v: boolean, ms: number): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(v), ms);
  };
  return {
    open,
    setOpen: (v) => {
      clearTimeout(timer.current);
      setOpen(v);
    },
    hover: { onPointerEnter: () => later(true, open ? 0 : OPEN_DELAY_MS), onPointerLeave: () => later(false, CLOSE_DELAY_MS) },
  };
}

/**
 * How full this conversation's context is: a small ring and the percentage beside the send
 * button, neutral until 70%, amber, then red at 90%. Hover for the details and Compact now.
 */
export function ContextMeter({ channel }: { channel: string }) {
  const model = useMeter(channel);
  const local = useLocalRun(channel);
  const { open, setOpen, hover } = useHoverOpen();
  const t = useT();
  if (!model) return null;
  const label = model.compacting ? t('chat.context.compacting') : `${model.pct}%`;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cx(s.meter, model.compacting ? s.spinning : model.tone === 'full' ? s.full : model.tone === 'warn' && s.warn)}
          aria-label={model.compacting ? t('chat.context.ariaCompacting') : t('chat.context.ariaUsed', { pct: model.pct })}
          data-context-meter={model.compacting ? 'compacting' : model.tone}
          {...hover}
        >
          <Ring pct={model.pct} spinning={model.compacting} />
          {label}
          {/* i18n-ignore */}
          {local?.tps && !model.compacting ? <span className={s.speed} data-local-speed="">{`· ${local.tps} tok/s`}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={s.popover} data-tone={model.tone} side="top" align="end" sideOffset={8} collisionPadding={12} aria-label={t('chat.context.title')} {...hover} onOpenAutoFocus={(e) => e.preventDefault()}>
          <MeterDetails channel={channel} model={model} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The popover: the numbers, where they come from, the model's window, compactions, Compact now. */
function MeterDetails({ channel, model }: { channel: string; model: MeterModel }) {
  const api = useApi();
  const { client } = useBeluga();
  const prefs = useApp((st) => st.prefs);
  const picked = useApp((st) => modelOf(st, channel));
  const modelName = useApp((st) => modelLabel(st, picked));
  // A workspace someone shared with you: their Claude, so only they can compact it.
  const theirs = useApp((st) => st.view.kind === 'shared');
  const local = useLocalRun(channel);
  const info = model.info;
  const rows = info ? breakdownRows(info) : [];
  const at = clampThreshold(prefs.autoCompactAt);
  const t = useT();
  const compact = (): void => {
    api.session.compact(channel).then(
      () => (model.busy ? toast(client, t('chat.context.compactsLater'), 'info') : undefined),
      (err: unknown) => toast(client, t('chat.context.couldntCompact', { error: err instanceof Error ? err.message : String(err) }), 'error'),
    );
  };
  return (
    <>
      <div className={s.head}>
        <span className={s.title}>{t('chat.context.title')}</span>
        <span className={cx(s.pct, model.tone === 'full' ? s.full : model.tone === 'warn' && s.warn)}>{model.compacting ? '…' : `${model.pct}%`}</span>
      </div>
      {info ? (
        <>
          <div className={s.bar} role="img" aria-label={usageLine(info)}>
            {rows.length ? rows.map((r) => <span key={r.key} className={s[`seg_${r.key}`]} style={{ width: `${r.share * 100}%` }} />) : <span className={s.seg_used} style={{ width: `${model.pct}%` }} />}
            {prefs.autoCompact ? <i className={s.mark} style={{ left: `${at}%` }} title={t('chat.context.autoAt', { at })} /> : null}
          </div>
          <div className={s.sub} data-context-usage="">
            {usageLine(info)}
            {info.window > info.used ? t('chat.context.left', { tokens: formatTokenCount(info.window - info.used) }) : ''}
          </div>
          {rows.length ? (
            <dl className={s.rows}>
              {rows.map((r) => (
                <div key={r.key} style={{ display: 'contents' }}>
                  <dt>
                    <span className={cx(s.swatch, s[`seg_${r.key}`])} />
                    {r.label}
                  </dt>
                  <dd>{formatTokenCount(r.tokens)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
      <dl className={cx(s.rows, s.facts)}>
        <dt>{t('chat.context.modelWindow')}</dt>
        <dd>
          {formatTokenCount(info?.window ?? contextWindowFor(picked))}
          {modelName ? ` · ${modelName}` : ''}
        </dd>
        {local ? (
          <>
            <dt>{t('chat.context.thisConversation')}</dt>
            <dd data-local-usage="">{t('chat.context.localUsage', { tokens: formatTokenCount(local.tokens), speed: speedWords(local.tps) })}</dd>
          </>
        ) : null}
        <dt>{t('chat.context.lastCompacted')}</dt>
        <dd>{model.last ? `${whenText(model.last.ts)} · ${formatTokenCount(model.last.compact.pre ?? 0)} → ${formatTokenCount(model.last.compact.post ?? 0)}` : t('chat.context.notYet')}</dd>
        <dt>{t('chat.context.autoCompact')}</dt>
        <dd>{prefs.autoCompact ? t('chat.context.at', { at }) : t('common.off')}</dd>
      </dl>
      {theirs ? (
        <div className={s.actions}>
          <span className={s.hint}>{t('chat.context.theirs')}</span>
        </div>
      ) : (
        <div className={s.actions}>
          <span className={s.hint}>{t('chat.context.keeps')}</span>
          <button type="button" className={s.compact} disabled={model.compacting} onClick={compact}>
            {model.compacting ? t('chat.context.compacting') : model.busy ? t('chat.context.compactAfter') : t('chat.context.compactNow')}
          </button>
        </div>
      )}
    </>
  );
}

/** The toolbar's quiet note once a conversation is getting full ("78% context"). */
export function ContextNote({ channel, className }: { channel: string; className?: string }) {
  const model = useMeter(channel);
  const t = useT();
  if (!model || (!model.compacting && model.tone === 'normal')) return null;
  return (
    <span className={cx(className, s.note, model.compacting ? undefined : model.tone === 'full' ? s.full : s.warn)} title={model.info ? usageLine(model.info) : undefined}>
      {model.compacting ? t('chat.context.compactingContext') : t('chat.context.note', { pct: model.pct })}
    </span>
  );
}
