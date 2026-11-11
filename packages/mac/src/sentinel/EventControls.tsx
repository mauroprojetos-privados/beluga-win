import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { BelugaTrigger, GitHubTrigger, Sentinel, SentryTrigger, StripeTrigger, Trigger, UptimeTrigger, WebhookAddress, WebhookTrigger } from '@beluga/core/sentinel/model.js';
import { TextInput } from '../components/FormSheet.js';
import { Icon } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { Button, Tip, cx } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { openSheet } from '../lib/sheets.js';
import { type EventCard, GITHUB_MINUTES, SIGNATURES, UPTIME_MINUTES, webhookMoves, eventCards, eventSentence, looksLikeUrl, troubleOf } from './sentinel-model.js';
import { useT } from '../lib/i18n.js';
import { useDraft } from './use-draft.js';
import s from './sentinel.module.css';

/**
 * The When card for events (docs/sentinel.md §3): the kind's events as cards (a radio group, the
 * arrows move), that kind's few fields, one sentence of what will happen, and what's in the way
 * (no gh, no Stripe key, no token, the tunnel) as a soft line with what to do.
 */

type Save = (patch: { trigger: Trigger }) => void;

export function EventControls({ item, save }: { item: Sentinel; save: Save }) {
  const t = useT();
  const tr = item.trigger;
  const trouble = useApp((st) => troubleOf(st.sentinel, item));
  const project = useApp((st) => st.projects.find((p) => p.id === item.projectId));
  const repo = useRepo(tr.kind === 'github' ? item.projectId : undefined);
  const set = (next: Trigger): void => save({ trigger: next });
  const cards = eventCards(tr.kind);
  const sentence = eventSentence(tr, { ...(project ? { project: project.name } : {}), ...(repo ? { repo } : {}) });
  return (
    <>
      {cards && 'what' in tr ? <EventCards cards={cards} value={tr.what} label={t('sentinel.cards.whatStarts')} onChange={(what) => set({ ...tr, what } as Trigger)} /> : null}
      {tr.kind === 'beluga' ? <BelugaFields t={tr} set={set} /> : null}
      {tr.kind === 'github' ? <GitHubFields t={tr} set={set} repo={repo} hasProject={Boolean(item.projectId)} /> : null}
      {tr.kind === 'stripe' ? <StripeFields t={tr} project={project?.name} /> : null}
      {tr.kind === 'uptime' ? <UptimeFields t={tr} set={set} /> : null}
      {tr.kind === 'sentry' ? <SentryFields t={tr} set={set} /> : null}
      {tr.kind === 'webhook' ? <WebhookFields t={tr} item={item} set={set} /> : null}
      {sentence ? <p className={s.eventSentence}>{sentence}</p> : null}
      {trouble ? (
        <p className={s.trouble} role="status" data-testid="sentinel-trouble">
          <Icon name="alert" size={12} />
          <span>{trouble}</span>
        </p>
      ) : null}
    </>
  );
}

/** A project's GitHub repository ("acme/bob-api"), read from its remote (no network). */
function useRepo(projectId: string | undefined): string | undefined {
  const api = useApi();
  const [repo, setRepo] = useState<string>();
  useEffect(() => {
    setRepo(undefined);
    if (!projectId) return;
    let alive = true;
    api.git.githubRepo(projectId).then(
      (r) => alive && setRepo(r ? `${r.owner}/${r.repo}` : undefined),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [projectId]);
  return repo;
}

/** The plans' AutonomyCards pattern: cards you can read without hovering. */
function EventCards<W extends string>({ cards, value, label, onChange }: { cards: ReadonlyArray<EventCard<W>>; value: W; label: string; onChange: (v: W) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const at = Math.max(0, cards.findIndex((c) => c.value === value));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (at + step + cards.length) % cards.length;
    onChange(cards[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div className={s.eventCards} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {cards.map((c, i) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            ref={(el) => void (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={cx(s.eventCard, on && s.eventCardOn)}
            onClick={() => onChange(c.value)}
          >
            <span className={s.eventIcon} aria-hidden="true">
              <Icon name={c.icon} size={14} />
            </span>
            <span className={s.eventName}>{c.label}</span>
            <span className={s.eventLine}>{c.line}</span>
          </button>
        );
      })}
    </div>
  );
}

function BelugaFields({ t: tr, set }: { t: BelugaTrigger; set: (t: Trigger) => void }) {
  const t = useT();
  const projects = useApp((st) => st.projects).filter((p) => p.root && !p.error);
  const ANY = '*';
  return (
    <div className={s.controlRow}>
      <span className={s.controlLabel}>{t('sentinel.events.in')}</span>
      <Select
        label={t('sentinel.events.inWhich')}
        size="small"
        value={tr.projectId ?? ANY}
        options={[{ value: ANY, label: t('sentinel.events.anyProject') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        onChange={(v) => {
          const { projectId: _p, ...rest } = tr;
          set(v === ANY ? rest : { ...rest, projectId: v });
        }}
      />
    </div>
  );
}

function GitHubFields({ t: tr, set, repo, hasProject }: { t: GitHubTrigger; set: (t: Trigger) => void; repo: string | undefined; hasProject: boolean }) {
  const t = useT();
  const label = useDraft(tr.label ?? '', (v) => {
    const next = v.trim();
    if (next === (tr.label ?? '')) return;
    const { label: _l, ...rest } = tr;
    set(next ? { ...rest, label: next } : rest);
  });
  const minutes = tr.minutes ?? 2;
  const choices = GITHUB_MINUTES.includes(minutes) ? GITHUB_MINUTES : [...GITHUB_MINUTES, minutes].sort((a, b) => a - b);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.events.repository')}</span>
        <span className={cx(s.staticValue, repo && s.mono)}>{repo ?? (hasProject ? t('sentinel.events.projectRepo') : t('sentinel.events.pickProject'))}</span>
      </div>
      {tr.what === 'issue-labelled' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{t('sentinel.events.label')}</span>
          <TextInput className={s.shortField} value={label.text} onChange={label.change} onBlur={label.flush} placeholder={t('sentinel.events.anyLabel')} aria-label={t('sentinel.events.label')} />
        </div>
      ) : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.events.look')}</span>
        <Select label={t('sentinel.events.howOftenGithub')} size="small" value={String(minutes)} options={choices.map((m) => ({ value: String(m), label: t('sentinel.events.everyMinutes', { count: m }) }))} onChange={(v) => set({ ...tr, minutes: Number(v) })} />
      </div>
    </>
  );
}

function StripeFields({ project }: { t: StripeTrigger; project: string | undefined }) {
  const t = useT();
  return (
    <div className={s.controlRow}>
      <span className={s.controlLabel}>{t('sentinel.events.account')}</span>
      <span className={s.staticValue}>{project ? t('sentinel.events.stripeOf', { project }) : t('sentinel.events.pickProject')}</span>
    </div>
  );
}

function UptimeFields({ t: tr, set }: { t: UptimeTrigger; set: (t: Trigger) => void }) {
  const t = useT();
  const [bad, setBad] = useState(false);
  const url = useDraft(tr.url, (v) => {
    const next = v.trim();
    setBad(!looksLikeUrl(next));
    if (next !== tr.url && looksLikeUrl(next)) set({ ...tr, url: next });
  });
  const expect = tr.expect ?? 200;
  const statuses = [200, 204, 301, 302, 401, 403].includes(expect) ? [200, 204, 301, 302, 401, 403] : [200, 204, 301, 302, 401, 403, expect];
  return (
    <>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.address')}</span>
        <div className={s.urlRow}>
          {/* i18n-ignore: a sample address */}
          <TextInput className={s.grow} value={url.text} onChange={url.change} onBlur={url.flush} mono invalid={bad} placeholder="https://example.com" aria-label={t('sentinel.events.addressCheck')} />
        </div>
        {bad ? <span className={s.help}>{t('sentinel.events.wholeAddress')}</span> : null}
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.events.check')}</span>
        <Select label={t('sentinel.events.howOftenChecked')} size="small" value={String(tr.minutes)} options={UPTIME_MINUTES.map((m) => ({ value: String(m), label: t('sentinel.events.everyMinutes', { count: m }) }))} onChange={(v) => set({ ...tr, minutes: Number(v) as UptimeTrigger['minutes'] })} />
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.events.expect')}</span>
        <Select
          label={t('sentinel.events.statusAria')}
          size="small"
          value={String(expect)}
          options={statuses.map((n) => ({ value: String(n), label: String(n), description: n === 200 ? t('sentinel.events.s200') : n === 204 ? t('sentinel.events.s204') : n === 301 || n === 302 ? t('sentinel.events.s30x') : t('sentinel.events.s40x') }))}
          onChange={(v) => {
            const n = Number(v);
            const { expect: _e, ...rest } = tr;
            set(n === 200 ? rest : { ...rest, expect: n });
          }}
        />
      </div>
    </>
  );
}

function SentryFields({ t: tr, set }: { t: SentryTrigger; set: (t: Trigger) => void }) {
  const t = useT();
  const org = useDraft(tr.org, (v) => v.trim() !== tr.org && set({ ...tr, org: v.trim() }));
  const project = useDraft(tr.project, (v) => v.trim() !== tr.project && set({ ...tr, project: v.trim() }));
  return (
    <div className={s.controlRow}>
      <span className={s.controlLabel}>{t('sentinel.page.project')}</span>
      <span className={s.pair}>
        <TextInput className={s.shortField} value={org.text} onChange={org.change} onBlur={org.flush} mono placeholder={t('sentinel.events.orgPlaceholder')} aria-label={t('sentinel.events.sentryOrg')} />
        <span className={s.slash}>/</span>
        <TextInput className={s.shortField} value={project.text} onChange={project.change} onBlur={project.flush} mono placeholder={t('sentinel.events.projectPlaceholder')} aria-label={t('sentinel.events.sentryProject')} />
      </span>
    </div>
  );
}

function WebhookFields({ t: tr, item, set }: { t: WebhookTrigger; item: Sentinel; set: (t: Trigger) => void }) {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const tunnel = useApp((st) => st.sentinel.webhook);
  const [address, setAddress] = useState<WebhookAddress>();
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let alive = true;
    api.sentinel.webhookUrl(item.id).then(
      (a) => alive && setAddress(a),
      (err: unknown) => alive && setAddress({ why: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
  }, [item.id, item.paused, tunnel?.url, tunnel?.ready, turn]);
  const copy = (text: string, what: string): void => void copyText(text).then(() => toast(client, t('sentinel.events.copied', { what }), 'success'));
  const rotate = (): void =>
    openSheet({
      kind: 'confirm',
      title: t('sentinel.events.rotateTitle', { name: item.name }),
      message: t('sentinel.events.rotateMessage'),
      confirm: t('sentinel.events.rotate'),
      destructive: true,
      run: () =>
        void api.sentinel.rotateSecret(item.id).then(
          (a) => {
            setAddress(a);
            setTurn((n) => n + 1);
            toast(client, t('sentinel.events.rotated'), 'success');
          },
          (err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'),
        ),
    });
  // GitHub's form asks for the signing secret, never the one in the URL.
  const secret = address?.signingSecret;
  return (
    <>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.url')}</span>
        <div className={s.urlRow}>
          <input className={cx(s.copyField, 'selectable')} readOnly value={address?.url ?? ''} placeholder={address?.why ?? t('sentinel.events.looking')} aria-label={t('sentinel.events.webhookUrl')} data-testid="webhook-url" onFocus={(e) => e.currentTarget.select()} />
          <Button size="small" icon="copy" disabled={!address?.url} onClick={() => address?.url && copy(address.url, t('sentinel.events.theWebhookUrl'))}>
            {t('sentinel.events.copy')}
          </Button>
        </div>
        <span className={s.hintLine}>{address?.url && address.why ? `${address.why}. ` : ''}{webhookMoves()}</span>
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.events.signature')}</span>
        <Select
          label={t('sentinel.events.signature')}
          size="small"
          value={tr.signature ?? 'none'}
          options={SIGNATURES}
          onChange={(v) => {
            const { signature: _s, ...rest } = tr;
            set(v === 'none' ? rest : { ...rest, signature: v });
          }}
        />
        {tr.signature === 'github' && secret ? (
          <Tip label={t('sentinel.events.secretTip')}>
            <Button size="small" variant="quiet" icon="copy" onClick={() => copy(secret, t('sentinel.events.theSecret'))}>
              {t('sentinel.events.copySecret')}
            </Button>
          </Tip>
        ) : null}
        <span className={s.grow} />
        <Button size="small" variant="quiet" icon="refresh" onClick={rotate}>
          {t('sentinel.events.rotateMenu')}
        </Button>
      </div>
    </>
  );
}
