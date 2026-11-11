import { type ReactNode, useState } from 'react';
import type { ProjectEarnings, MoneyTotal } from '@beluga/core/earnings-store.js';
import type { RevenueCatApp, ProjectRevenueCat } from '@beluga/core/revenuecat-store.js';
import type { Project } from '@beluga/workspaces/types.js';
import { stripeKeyKind, stripeKeyProblem } from '@beluga/shared/stripe-keys.js';
import { revenueCatKeyProblem } from '@beluga/shared/revenuecat-keys.js';
import { type Key, t as tt } from '@beluga/shared/i18n/index.js';
import { Alert, Checkbox } from '../components/Alert.js';
import { Field, FormSheet, Popup, TextInput, formStyles as f } from '../components/FormSheet.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { rangeFigures } from '@beluga/core/earnings-store.js';
import { REVENUECAT_KEY_URL, STRIPE_KEY_URL, closeEarnings, formatMoney, missingNote, refreshEarnings, sourcesOf, updatedAgo, useCombinedEarnings, useConverted, useEarningsSheet, useProjectEarnings } from '../lib/earnings.js';
import { CurrencySelect } from './EarningsSettings.js';
import { brandText } from '../lib/brand.js';
import { useApi, useApp } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import { openExternal } from '../lib/system.js';
import s from './earnings.module.css';
import { thisComputer } from '../lib/os-words.js';

/** A sentence whose `{slots}` are bold words, in the app's language. */
function withBold(key: Key, words: Readonly<Record<string, string>>): ReactNode[] {
  return tt(key).split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <b key={i}>{words[part] ?? part}</b> : part));
}

/**
 * Earnings for a project, from Stripe and RevenueCat: its home says what both brought in and
 * lists each connected source (amount, status, its own links) or, with none, offers to connect
 * either. Each source has its own form: a key field (masked, paste-aware, checked as you type),
 * where to make a key that can only read, and for RevenueCat the apps that count.
 */
export function EarningsSheet() {
  const sheet = useEarningsSheet();
  if (!sheet) return null;
  return <EarningsSheetBody key={`${sheet.projectId ?? 'pick'}:${sheet.source ?? ''}`} initial={sheet.projectId} source={sheet.source} />;
}

type View = 'home' | 'stripe' | 'revenuecat' | 'apps';

function EarningsSheetBody({ initial, source }: { initial: string | undefined; source: 'stripe' | 'revenuecat' | undefined }) {
  const t = useT();
  const all = useApp((st) => st.projects);
  const combined = useCombinedEarnings();
  const projects = all.filter((p) => p.root);
  const [projectId, setProjectId] = useState(() => initial ?? projects.find((p) => !combined[p.root])?.id ?? projects[0]?.id);
  const [view, setView] = useState<View>(source ?? 'home');
  const [confirm, setConfirm] = useState<'stripe' | 'revenuecat'>();
  const api = useApi();
  const project = projects.find((p) => p.id === projectId);
  const connected = useProjectEarnings(project?.root);
  if (!project) {
    return <FormSheet title={t('sheets.earnings.connectEarnings')} icon="coin" intro={t('sheets.earnings.addProjectFirst')} submitLabel={t('common.done')} hideSubmit onSubmit={() => undefined} onCancel={closeEarnings} />;
  }
  const stripe = connected?.stripe;
  const rc = connected?.revenuecat;
  const home = (): void => setView('home');
  // Opened straight onto a form that has nothing behind it: Cancel closes the sheet.
  const back = source && !connected ? undefined : home;
  if (confirm === 'stripe' || confirm === 'revenuecat') {
    const rest = confirm === 'stripe' ? rc : stripe;
    return (
      <Alert
        title={t('sheets.earnings.disconnectTitle', { source: confirm === 'stripe' ? 'Stripe' : 'RevenueCat', project: project.name })}
        message={confirm === 'stripe' ? t('sheets.earnings.disconnectStripe') : t('sheets.earnings.disconnectRevenueCat')}
        tone="danger"
        cancel={t('common.cancel')}
        confirm={{
          label: t('sheets.earnings.disconnect'),
          destructive: true,
          onClick: () => {
            void (confirm === 'stripe' ? api.stripe.disconnect(project.id) : api.revenuecat.disconnect(project.id));
            if (rest) {
              setConfirm(undefined);
              home();
            } else closeEarnings();
          },
        }}
        onCancel={() => setConfirm(undefined)}
      />
    );
  }
  if (view === 'stripe') return <ConnectForm project={project} replacing={Boolean(stripe)} onBack={back} onDone={home} />;
  if (view === 'revenuecat') return <RevenueCatForm project={project} replacing={Boolean(rc)} onBack={back} onDone={home} />;
  if (view === 'apps' && rc) return <ChooseApps project={project} rc={rc} onBack={home} />;
  return (
    <Home
      project={project}
      projects={initial ? undefined : projects}
      onProject={setProjectId}
      stripe={stripe}
      rc={rc}
      onOpen={setView}
      onDisconnect={setConfirm}
    />
  );
}

function ConnectForm({ project, replacing, onBack, onDone }: { project: Project; replacing: boolean; onBack: (() => void) | undefined; onDone: () => void }) {
  const t = useT();
  const api = useApi();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [touched, setTouched] = useState(false);
  const trimmed = key.trim();
  const problem = trimmed ? stripeKeyProblem(trimmed) : undefined;
  const kind = stripeKeyKind(trimmed);
  const showProblem = problem && (touched || pasted);
  return (
    <FormSheet
      title={replacing ? t('sheets.earnings.replaceStripeTitle', { project: project.name }) : t('sheets.earnings.connectStripeTitle', { project: project.name })}
      icon="coin"
      intro={<p>{t('sheets.earnings.stripeIntro', { project: project.name, computer: thisComputer() })}</p>}
      submitLabel={t('sheets.earnings.connect')}
      canSubmit={Boolean(trimmed) && !problem}
      onCancel={onBack ?? closeEarnings}
      cancelLabel={onBack ? t('common.back') : t('common.cancel')}
      width={560}
      onSubmit={async () => {
        const result = await api.stripe.connect(project.id, trimmed);
        if (!result.ok) return result.error;
        setKey('');
        onDone();
        return undefined;
      }}
    >
      <Field
        label={t('sheets.earnings.restrictedKey')}
        htmlFor="stripe-key"
        error={showProblem ? problem : undefined}
        hint={
          kind.secret && !problem ? (
            <span className={s.caution}>
              <Icon name="alert" size={11} />
              {t('sheets.earnings.fullSecretKey')}
            </span>
          ) : pasted && !problem ? (
            t('sheets.earnings.pastedStripe')
          ) : (
            t('sheets.earnings.startsWithRk')
          )
        }
        aside={
          <>
            {kind.mode && !problem ? <ModeBadge mode={kind.mode} /> : null}
            <button type="button" className={s.reveal} aria-label={reveal ? t('sheets.earnings.hideKey') : t('sheets.earnings.showKey')} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
              <Icon name="eye" size={13} />
            </button>
          </>
        }
      >
        <TextInput
          id="stripe-key"
          type={reveal ? 'text' : 'password'}
          mono
          placeholder="rk_live_…" // i18n-ignore
          value={key}
          invalid={Boolean(showProblem)}
          onChange={(v) => {
            setKey(v);
            setPasted(false);
          }}
          onBlur={() => setTouched(true)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim();
            if (!text) return;
            e.preventDefault();
            setKey(text);
            setPasted(true);
          }}
          data-autofocus
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      <div className={s.howto}>
        <div className={s.howtoHead}>
          <span>{t('sheets.earnings.noKeyYet')}</span>
          <button type="button" className={f.linkButton} onClick={() => void openExternal(STRIPE_KEY_URL)}>
            {t('sheets.earnings.createRestrictedKey')}
            <Icon name="forward" size={10} />
          </button>
        </div>
        <ol className={s.steps}>
          <li>{withBold('sheets.earnings.stripeStep1', { charges: t('sheets.earnings.charges'), read: t('sheets.earnings.read') })}</li>
          <li>{withBold('sheets.earnings.stripeStep2', { accounts: t('sheets.earnings.accounts'), read: t('sheets.earnings.read') })}</li>
          <li>{t('sheets.earnings.stripeStep3')}</li>
        </ol>
        <div className={s.counted}>{t('sheets.earnings.stripeCounted')}</div>
      </div>
    </FormSheet>
  );
}

function ModeBadge({ mode }: { mode: 'live' | 'test' }) {
  const t = useT();
  return <span className={cx(s.badge, mode === 'live' ? s.live : s.testMode)}>{mode === 'live' ? t('sheets.earnings.live') : t('sheets.earnings.test')}</span>;
}


/** A store as people know it, from RevenueCat's app type. */
const STORES: Readonly<Record<string, string>> = {
  app_store: 'App Store',
  mac_app_store: 'Mac App Store',
  play_store: 'Google Play',
  amazon: 'Amazon',
  stripe: 'Stripe',
  rc_billing: 'Web Billing',
  roku: 'Roku',
  paddle: 'Paddle',
  test_store: 'Test Store',
};
const storeLabel = (store: string): string => STORES[store] ?? store.replace(/_/g, ' ');

/** What a source brought in: all-time, in the currency earnings show in (≈ when converted). */
function useAmount(totals: readonly MoneyTotal[] | undefined): string {
  const t = useT();
  const money = useConverted(totals);
  return totals ? `${money.converted ? '≈ ' : ''}${formatMoney(money.amount, money.currency)}` : t('sheets.earnings.counting');
}

/** "Counting…", or when it was last counted. */
const countedWhen = (refreshing: boolean | undefined, at: number | undefined): string => (refreshing ? tt('sheets.earnings.counting') : tt('sheets.earnings.updated', { when: updatedAgo(at) }));

/** Connect, or the connected controls, for the project: both sources at a glance. */
function Home({ project, projects, onProject, stripe, rc, onOpen, onDisconnect }: { project: Project; projects: readonly Project[] | undefined; onProject: (id: string) => void; stripe: ProjectEarnings | undefined; rc: ProjectRevenueCat | undefined; onOpen: (v: View) => void; onDisconnect: (source: 'stripe' | 'revenuecat') => void }) {
  const t = useT();
  const api = useApi();
  const earnings = useProjectEarnings(project.root);
  const totals = earnings?.totals ?? [];
  const money = useConverted(totals);
  const breakdown = money.converted || money.missing.length > 0;
  const note = missingNote(money.missing);
  const month = earnings?.activity ? rangeFigures(earnings.activity, 30) : undefined;
  const monthMoney = useConverted(month?.totals);
  const picker =
    projects && projects.length > 1 ? (
      <Field label={t('sheets.earnings.project')} htmlFor="earnings-project">
        <Popup id="earnings-project" label={t('sheets.earnings.project')} value={project.id} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={onProject} />
      </Field>
    ) : null;
  if (!earnings) {
    return (
      <FormSheet
        title={t('sheets.earnings.connectEarningsTo', { project: project.name })}
        icon="coin"
        intro={<p>{t('sheets.earnings.homeIntro', { project: project.name, computer: thisComputer() })}</p>}
        submitLabel={t('common.done')}
        hideSubmit
                width={520}
        onSubmit={() => undefined}
        onCancel={closeEarnings}
      >
        {picker}
        <div className={s.cards}>
          <SourceCard name="Stripe" detail={t('sheets.earnings.stripeCard')} onConnect={() => onOpen('stripe')} />
          <SourceCard name="RevenueCat" detail={t('sheets.earnings.revenueCatCard')} onConnect={() => onOpen('revenuecat')} />
        </div>
      </FormSheet>
    );
  }
  return (
    <FormSheet
      title={t('sheets.earnings.projectEarnings', { project: project.name })}
      icon="coin"
      intro={
        <span className={s.account}>
          {stripe ? (
            <>
              {stripe.account ?? t('sheets.earnings.yourStripeAccount')}
              <ModeBadge mode={stripe.mode} />
            </>
          ) : null}
          {rc ? <span>{rc.project.name}</span> : null}
        </span>
      }
      submitLabel={t('common.done')}
      hideSubmit
      cancelLabel={t('common.done')}
      width={480}
      onSubmit={() => undefined}
      onCancel={closeEarnings}
    >
      {picker}
      <div className={cx(s.total, earnings.refreshing && s.counting)} aria-live="polite">
        <span className={s.totalLabel}>{t('sheets.earnings.allTime')}</span>
        <span className={s.totalValue}>{earnings.totals ? `${money.converted ? '≈ ' : ''}${formatMoney(money.amount, money.currency)}` : t('sheets.earnings.counting')}</span>
        {breakdown ? (
          <span className={s.others}>
            <span className={s.othersLabel}>{t('sheets.earnings.inSources', { sources: sourcesOf([earnings]) })}</span>
            {totals.map((m) => (
              <span key={m.currency}>{formatMoney(m.amount, m.currency)}</span>
            ))}
          </span>
        ) : null}
        {note ? <span className={s.note}>{note}</span> : null}
        {month ? (
          <span className={s.lately} data-last-30>
            {t(month.payers !== undefined ? 'sheets.earnings.last30By' : 'sheets.earnings.last30', {
              money: `${monthMoney.converted ? '≈ ' : ''}${formatMoney(monthMoney.amount, monthMoney.currency)}`,
              payments: t('sheets.earnings.payments', { count: month.payments }),
              customers: t('sheets.earnings.customers', { count: month.payers ?? 0 }),
            })}
          </span>
        ) : null}
        <span className={s.meta}>
          {countedWhen(earnings.refreshing, earnings.updatedAt)}
          <button type="button" className={f.linkButton} disabled={earnings.refreshing} onClick={() => refreshEarnings(api, project.id)}>
            {t('sheets.earnings.refreshNow')}
          </button>
        </span>
      </div>
      <Field label={t('sheets.earnings.currency')} htmlFor="earnings-currency" hint={t('sheets.earnings.currencyHint')}>
        <CurrencySelect id="earnings-currency" className={f.popup} />
      </Field>
      <div className={s.sources}>
        {stripe ? <StripeRow earnings={stripe} alone={!rc} onReplace={() => onOpen('stripe')} onDisconnect={() => onDisconnect('stripe')} /> : <SourceCard name="Stripe" detail={t('sheets.earnings.addStripe')} onConnect={() => onOpen('stripe')} />}
        {rc ? <RevenueCatRow rc={rc} alone={!stripe} onChoose={() => onOpen('apps')} onReplace={() => onOpen('revenuecat')} onDisconnect={() => onDisconnect('revenuecat')} /> : <SourceCard name="RevenueCat" detail={t('sheets.earnings.addRevenueCat')} onConnect={() => onOpen('revenuecat')} />}
      </div>
      {stripe?.secretKey ? (
        <div className={s.caution}>
          <Icon name="alert" size={11} />
          {t('sheets.earnings.secretKeyCaution')}
        </div>
      ) : null}
      <div className={s.counted}>
        {stripe ? `${t('sheets.earnings.stripeCountedShort')} ` : ''}
        {rc ? `${t('sheets.earnings.revenueCatCountedShort')} ` : ''}
        {t('sheets.earnings.looksBySelf')}
      </div>
    </FormSheet>
  );
}

/** A source that isn't connected yet, with its way in. */
function SourceCard({ name, detail, onConnect }: { name: string; detail: string; onConnect: () => void }) {
  const t = useT();
  return (
    <section className={cx(s.source, s.card)} aria-label={name}>
      <span className={s.sourceMain}>
        <span className={s.sourceName}>{name}</span>
        <span className={s.sourceDetail}>{detail}</span>
      </span>
      <button type="button" className={f.linkButton} onClick={onConnect}>
        {t('sheets.earnings.connectSource', { source: name })}
      </button>
    </section>
  );
}

function ProblemLine({ error, onReplace }: { error: NonNullable<ProjectEarnings['error']>; onReplace: () => void }) {
  const t = useT();
  const needsKey = error.code === 'revoked' || error.code === 'permission';
  return (
    <div className={s.problem} role="status">
      <Icon name="alert" size={13} />
      <span>{brandText(error.message)}</span>
      {needsKey ? (
        <button type="button" className={f.linkButton} onClick={onReplace}>
          {t('sheets.earnings.connectNewKey')}
        </button>
      ) : null}
    </div>
  );
}

function StripeRow({ earnings, alone, onReplace, onDisconnect }: { earnings: ProjectEarnings; alone: boolean; onReplace: () => void; onDisconnect: () => void }) {
  const t = useT();
  const amount = useAmount(earnings.totals);
  return ( // i18n-ignore
    <section className={s.source} aria-label="Stripe">
      <span className={s.sourceMain}>
        {/* i18n-ignore */}
        <span className={s.sourceName}>Stripe</span>
        <span className={s.sourceDetail}>{countedWhen(earnings.refreshing, earnings.updatedAt)}</span>
      </span>
      {alone ? null : <span className={s.sourceAmount}>{amount}</span>}
      <span className={s.sourceLinks}>
        <button type="button" className={f.linkButton} onClick={onReplace}>
          {t('sheets.earnings.replaceKey')}
        </button>
        <button type="button" className={f.linkDanger} onClick={onDisconnect}>
          {t('sheets.earnings.disconnectMore')}
        </button>
      </span>
      {earnings.error ? <ProblemLine error={earnings.error} onReplace={onReplace} /> : null}
    </section>
  );
}

function RevenueCatRow({ rc, alone, onChoose, onReplace, onDisconnect }: { rc: ProjectRevenueCat; alone: boolean; onChoose: () => void; onReplace: () => void; onDisconnect: () => void }) {
  const t = useT();
  const amount = useAmount(rc.totals);
  const counted = rc.apps.filter((a) => a.counted).length;
  return ( // i18n-ignore
    <section className={s.source} aria-label="RevenueCat">
      <span className={s.sourceMain}>
        {/* i18n-ignore */}
        <span className={s.sourceName}>RevenueCat</span>
        <span className={s.sourceDetail}>
          {countedWhen(rc.refreshing, rc.updatedAt)}
          {rc.apps.length ? ` · ${t('sheets.earnings.appsCounted', { counted, count: rc.apps.length })}` : ''}
        </span>
      </span>
      {alone ? null : <span className={s.sourceAmount}>{counted ? amount : '—'}</span>}
      <span className={s.sourceLinks}>
        <button type="button" className={f.linkButton} onClick={onChoose}>
          {t('sheets.earnings.chooseApps')}
        </button>
        <button type="button" className={f.linkButton} onClick={onReplace}>
          {t('sheets.earnings.replaceKey')}
        </button>
        <button type="button" className={f.linkDanger} onClick={onDisconnect}>
          {t('sheets.earnings.disconnectMore')}
        </button>
      </span>
      {rc.apps.length && !counted ? (
        <div className={s.sourceNote}>
          {t('sheets.earnings.noAppsCounted')}{' '}
          <button type="button" className={f.linkButton} onClick={onChoose}>
            {t('sheets.earnings.chooseApps')}
          </button>
        </div>
      ) : null}
      {rc.warning === 'shared' ? <div className={s.sourceNote}>{t('sheets.earnings.sharedProject')}</div> : null}
      {rc.error ? <ProblemLine error={rc.error} onReplace={onReplace} /> : null}
    </section>
  );
}

/** The RevenueCat key form: checked as you type, then (with several RevenueCat projects) which one. */
function RevenueCatForm({ project, replacing, onBack, onDone }: { project: Project; replacing: boolean; onBack: (() => void) | undefined; onDone: () => void }) {
  const t = useT();
  const api = useApi();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pick, setPick] = useState<ReadonlyArray<{ id: string; name: string }>>();
  const [chosen, setChosen] = useState('');
  const trimmed = key.trim();
  const problem = trimmed ? revenueCatKeyProblem(trimmed) : undefined;
  const showProblem = problem && (touched || pasted);
  return (
    <FormSheet
      title={replacing ? t('sheets.earnings.replaceRevenueCatTitle', { project: project.name }) : t('sheets.earnings.connectRevenueCatTitle', { project: project.name })}
      icon="coin"
      intro={<p>{t('sheets.earnings.revenueCatIntro', { project: project.name, computer: thisComputer() })}</p>}
      submitLabel={t('sheets.earnings.connect')}
      canSubmit={Boolean(trimmed) && !problem && (!pick || Boolean(chosen))}
      onCancel={onBack ?? closeEarnings}
      cancelLabel={onBack ? t('common.back') : t('common.cancel')}
      width={560}
      onSubmit={async () => {
        const result = await api.revenuecat.connect(project.id, trimmed, pick ? chosen : undefined);
        if ('pick' in result) {
          setPick(result.pick);
          setChosen(result.pick[0]?.id ?? '');
          return undefined;
        }
        if (!result.ok) return result.error;
        setKey('');
        onDone();
        return undefined;
      }}
    >
      <Field
        label={t('sheets.earnings.secretKey')}
        htmlFor="revenuecat-key"
        error={showProblem ? problem : undefined}
        hint={pick ? t('sheets.earnings.checkedChoose') : pasted && !problem ? t('sheets.earnings.pastedRevenueCat') : t('sheets.earnings.v2Key')}
        aside={
          <button type="button" className={s.reveal} aria-label={reveal ? t('sheets.earnings.hideKey') : t('sheets.earnings.showKey')} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
            <Icon name="eye" size={13} />
          </button>
        }
      >
        <TextInput
          id="revenuecat-key"
          type={reveal ? 'text' : 'password'}
          mono
          placeholder="sk_…" // i18n-ignore
          value={key}
          invalid={Boolean(showProblem)}
          onChange={(v) => {
            setKey(v);
            setPasted(false);
            setPick(undefined);
          }}
          onBlur={() => setTouched(true)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim();
            if (!text) return;
            e.preventDefault();
            setKey(text);
            setPasted(true);
            setPick(undefined);
          }}
          data-autofocus
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      {pick ? (
        <Field label={t('sheets.earnings.revenueCatProject')} htmlFor="revenuecat-project">
          <Popup id="revenuecat-project" label={t('sheets.earnings.revenueCatProject')} value={chosen} options={pick.map((p) => ({ value: p.id, label: p.name }))} onChange={setChosen} />
        </Field>
      ) : null}
      <div className={s.howto}>
        <div className={s.howtoHead}>
          <span>{t('sheets.earnings.noKeyYet')}</span>
          <button type="button" className={f.linkButton} onClick={() => void openExternal(REVENUECAT_KEY_URL)}>
            {t('sheets.earnings.howToSecretKey')}
            <Icon name="forward" size={10} />
          </button>
        </div>
        <ol className={s.steps}>
          <li>{withBold('sheets.earnings.revenueCatStep1', { where: t('sheets.earnings.apiKeysPlace'), v2: 'V2' })}</li>
          <li>{withBold('sheets.earnings.revenueCatStep2', { charts: t('sheets.earnings.chartsMetrics'), config: t('sheets.earnings.projectConfig') })}</li>
          <li>{t('sheets.earnings.revenueCatStep3')}</li>
        </ol>
        <div className={s.counted}>{t('sheets.earnings.revenueCatCounted')}</div>
      </div>
    </FormSheet>
  );
}

/** Why an app is, or isn't, counted by default (what Beluga decided; a tick of yours needs no note). */
function reasonNote(app: RevenueCatApp, holder: string | undefined): string | undefined {
  if (app.reason === 'sandbox') return tt('sheets.earnings.reasonSandbox');
  if (app.reason === 'stripe') return tt('sheets.earnings.reasonStripe', { project: holder ?? tt('sheets.earnings.anotherProject') });
  if (app.reason === 'maybe-stripe') return tt('sheets.earnings.reasonMaybeStripe');
  return undefined;
}

/** "Count revenue from": the RevenueCat apps, ticked when they count. */
function ChooseApps({ project, rc, onBack }: { project: Project; rc: ProjectRevenueCat; onBack: () => void }) {
  const t = useT();
  const api = useApi();
  const projects = useApp((st) => st.projects);
  const stripes = useApp((st) => st.earnings);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(rc.apps.filter((a) => a.counted).map((a) => a.id)));
  // The Beluga project that holds each connected Stripe account.
  const holders = new Map<string, string>();
  for (const [root, e] of Object.entries(stripes)) if (e.accountId) holders.set(e.accountId, projects.find((p) => p.root === root)?.name ?? t('sheets.earnings.anotherProject'));
  const twice = rc.apps.some((a) => ticked.has(a.id) && a.stripeAccount && holders.has(a.stripeAccount));
  return (
    <FormSheet
      title={t('sheets.earnings.chooseAppsFor', { project: project.name })}
      icon="coin"
      intro={<p>{t('sheets.earnings.chooseAppsIntro')}</p>}
      submitLabel={t('common.save')}
      cancelLabel={t('common.back')}
      onCancel={onBack}
      width={520}
      onSubmit={async () => {
        await api.revenuecat.setApps(project.id, rc.apps.filter((a) => ticked.has(a.id)).map((a) => a.id));
        onBack();
        return undefined;
      }}
    >
      <div className={s.appsHead}>{t('sheets.earnings.countRevenueFrom')}</div>
      <div className={s.apps} role="group" aria-label={t('sheets.earnings.countRevenueFrom')}>
        {rc.apps.length ? (
          rc.apps.map((a) => {
            const note = reasonNote(a, a.stripeAccount ? holders.get(a.stripeAccount) : undefined);
            return (
              <Checkbox
                key={a.id}
                checked={ticked.has(a.id)}
                onChange={(on) => setTicked((was) => (on ? new Set([...was, a.id]) : new Set([...was].filter((id) => id !== a.id))))}
                label={`${storeLabel(a.store)} · ${a.name}${a.stripeAccount ? ` · …${a.stripeAccount.slice(-4)}` : ''}`}
                {...(note ? { detail: note } : {})}
              />
            );
          })
        ) : (
          <span className={s.sourceDetail}>{t('sheets.earnings.noApps')}</span>
        )}
      </div>
      {twice ? (
        <div className={s.caution}>
          <Icon name="alert" size={11} />
          {t('sheets.earnings.countedTwice')}
        </div>
      ) : null}
    </FormSheet>
  );
}
