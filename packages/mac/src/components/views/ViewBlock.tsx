import { baseName } from '@beluga/shared/os-path.js';
import { Suspense, lazy, memo, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type ChartKind, type Column, type Row, type View, type ViewType, describeSource, parseView } from '@beluga/shared/view-spec.js';
import { ActionsContext, ActionsDropdown, type ActionItem } from '../SpecMenu.js';
import { CodeLines } from '../markdown/CodeLines.js';
import { useCopied } from '../markdown/CodeBlock.js';
import { Icon, type IconName } from '../Icon.js';
import { IconButton, Tip, cx } from '../ui.js';
import { copyRich, copyText } from '../../lib/copy.js';
import { saveTextAs } from '../../lib/save-text.js';
import { toast, useBeluga } from '../../lib/beluga.js';
import { useActions } from '../../lib/actions.js';
import { useClock } from '../../lib/window-active.js';
import { type ViewData, useViewData, useVisible } from './use-view-data.js';
import { ago, isNumeric, toHtmlTable, toMarkdownTable } from './format.js';
import { EXPORT_KINDS, type ExportKind, exportFileName, exportRows } from './export.js';
import { DataTable } from './Table.js';
import { StatTiles } from './Stats.js';
import { CodeView } from './Code.js';
import { ColorsView } from './Colors.js';
import { ControlsBar } from './Controls.js';
import { GanttView } from './Gantt.js';
import { HeatmapView } from './Heatmap.js';
import { CalendarView } from './Calendar.js';
import { tableRows, tableView } from './md-table.js';
import { useT } from '../../lib/i18n.js';
import v from './views.module.css';

type T = ReturnType<typeof useT>;

/**
 * A ```beluga-view block (or ```beluga-table, ```beluga-chart…) wherever Markdown is drawn: a
 * card with the element in it. Tables page, sort and search; a table turns into a chart and back;
 * a source (your own Claude's) is fetched for more and refreshed, live. While Claude is still
 * writing the block it says so; a block that's wrong says what's wrong and shows its JSON.
 */

const Chart = lazy(() => import('./Chart.js'));

const ICON: Record<ViewType, IconName> = { table: 'table', chart: 'chartLine', stats: 'gauge', code: 'command', colors: 'palette', gantt: 'gantt', heatmap: 'heat', calendar: 'calendar' };
/** "Showing a table…" while Claude is still writing the block. */
const showing = (t: T, type: ViewType | 'any' | undefined): string => {
  switch (type) {
    case 'table':
      return t('components.views.block.showingTable');
    case 'chart':
      return t('components.views.block.showingChart');
    case 'stats':
      return t('components.views.block.showingStats');
    case 'code':
      return t('components.views.block.showingCode');
    case 'colors':
      return t('components.views.block.showingColors');
    case 'gantt':
      return t('components.views.block.showingTimeline');
    case 'heatmap':
      return t('components.views.block.showingHeatmap');
    case 'calendar':
      return t('components.views.block.showingCalendar');
    default:
      return t('components.views.block.showingData');
  }
};
/** Views drawn from all their rows at once (not a page of them). */
const WHOLE: ReadonlySet<ViewType> = new Set(['chart', 'gantt', 'heatmap', 'calendar']);

export const ViewBlock = memo(function ViewBlock({ code, type, live = false, local = false }: { code: string; type?: ViewType | 'any'; live?: boolean; local?: boolean }) {
  const t = useT();
  const parsed = useMemo(() => parseView(code, type === 'any' ? undefined : type), [code, type]);
  if (!parsed.ok) {
    if (parsed.incomplete && live) {
      return (
        <figure className={v.card} data-state="drawing" aria-label={t('components.views.block.view')}>
          <div className={v.drawing}>
            <Icon name={type && type !== 'any' ? ICON[type] : 'grid'} size={14} />
            {showing(t, type)}
          </div>
        </figure>
      );
    }
    return (
      <figure className={v.cardError} data-state="error">
        <figcaption>{t('components.views.block.cantShow', { error: parsed.error })}</figcaption>
        <CodeLines text={code} lang="json" />
      </figure>
    );
  }
  return <ViewCard view={parsed.view} code={code} warnings={parsed.warnings} local={local} />;
});

/** What a table can be shown as. */
type Shape = 'table' | ChartKind;

function chartable(view: View, data: ViewData): boolean {
  return data.columns.some(isNumeric) && data.columns.length >= 2 && view.type !== 'stats';
}

function ViewCard({ view, code, warnings, local, bare = false }: { view: View; code: string; warnings: readonly string[]; local: boolean; bare?: boolean }) {
  const t = useT();
  const { client } = useBeluga();
  const [ref, visible] = useVisible<HTMLElement>();
  const [shape, setShape] = useState<Shape>(view.type === 'chart' ? view.chart : 'table');
  const [full, setFull] = useState(false);
  const [shown, setShown] = useShownValues();
  const asChart = view.type === 'chart' || (view.type === 'table' && shape !== 'table');
  const data = useViewData(view, { local, visible, ...(asChart || WHOLE.has(view.type) ? { limit: Math.max(view.pageSize, 500) } : {}), ...(view.type === 'code' ? { text: true } : {}) });
  const copySpec = (): void => void copyText(JSON.stringify(JSON.parse(code), null, 2)).then(() => toast(client, t('components.views.block.copiedJson'), 'success'));
  const rowsCopied = (n: number): string => t('components.views.block.copiedRows', { count: n });
  // A table copies as a table: HTML for Sheets, Numbers, Docs and Notion; Markdown for everything else.
  const [copied, copy] = useCopied();
  const tableCopy = view.type === 'table' && data.rows.length > 0;
  const copyTable = (): void =>
    copy(() => {
      const rows = data.allRows();
      const columns = data.columns.filter((c) => !c.hidden);
      return copyRich(toHtmlTable(rows, columns), toMarkdownTable(rows, columns)).then(() => toast(client, rowsCopied(rows.length), 'success'));
    });
  const exportable = data.rows.length > 0 && view.type !== 'code' && view.type !== 'colors';
  const openFull = t('components.views.openFull');
  const items: ActionItem[] = [
    ...(view.type !== 'code' && view.type !== 'colors' ? [{ label: openFull, icon: 'expand' as const, onSelect: () => setFull(true) }] : []),
    ...(tableCopy ? [{ label: t('components.views.block.copyTable'), icon: 'copy' as const, onSelect: copyTable }] : []),
    ...(exportable ? exportItems(t, view, data, (text, ok) => toast(client, text, ok ? 'success' : 'error'), shown, setShown) : []),
    { label: exportable ? t('components.views.block.copySpec') : t('components.views.copyAsJson'), icon: 'copy', separate: exportable, onSelect: copySpec },
    ...(data.mode === 'live' ? [{ label: t('components.views.block.refresh'), icon: 'refresh' as const, onSelect: data.refresh }] : []),
  ];
  const body = (inFull: boolean) => <Body view={view} data={data} shape={asChart ? (view.type === 'chart' && shape === 'table' ? view.chart : shape) : 'table'} full={inFull} />;
  const canSwitch = (view.type === 'table' || view.type === 'chart') && chartable(view, data);
  // Opened from the welcome (the tour's table): over it, not hidden behind it.
  const overWelcome = full && document.querySelector('[data-welcome]') ? '' : undefined;
  return (
    <>
      <ActionsContext items={items}>
        <figure ref={ref} className={cx(v.card, bare && v.bare)} data-type={view.type} data-state="ready" aria-label={view.title ? `${label(t, view.type)}: ${view.title}` : label(t, view.type)}>
          <Head view={view} data={data} warnings={warnings} shape={shape} setShape={canSwitch ? setShape : undefined} copy={tableCopy ? { copied, onCopy: copyTable } : undefined} more={exportable ? items : undefined} onExpand={!bare && items[0]?.label === openFull ? () => setFull(true) : undefined} bare={bare} />
          <ControlsBar view={view} data={data} />
          {data.needsApproval ? <Approve command={data.needsApproval} onRun={data.approve} /> : null}
          {data.error ? (
            <div className={v.problem} role="alert">
              <Icon name="alert" size={13} />
              <span>{t('components.views.block.couldntLoad', { error: data.error })}</span>
              {data.mode === 'live' ? (
                <button type="button" className={v.linkButton} onClick={data.refresh}>
                  {t('common.retry')}
                </button>
              ) : null}
            </div>
          ) : null}
          {body(false)}
          <Foot view={view} data={data} />
        </figure>
      </ActionsContext>
      {full ? (
        <Dialog.Root open onOpenChange={(open) => (open ? undefined : setFull(false))}>
          <Dialog.Portal>
            <Dialog.Overlay className={v.fullOverlay} data-over-welcome={overWelcome} />
            <Dialog.Content className={v.full} data-over-welcome={overWelcome} aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
              <Head view={view} data={data} warnings={warnings} shape={shape} setShape={canSwitch ? setShape : undefined} copy={tableCopy ? { copied, onCopy: copyTable } : undefined} more={exportable ? items.filter((it) => it.label !== openFull) : undefined} inFull onClose={() => setFull(false)} />
              <ControlsBar view={view} data={data} />
              <div className={v.fullBody}>{body(true)}</div>
              <Foot view={view} data={data} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </>
  );
}

/** Whether Copy as and Save as take the values as the table shows them ("$48,210") or raw (48210). Remembered. */
const SHOWN_KEY = 'beluga.tableExport.shown';
function useShownValues(): [boolean, (on: boolean) => void] {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(SHOWN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (on: boolean): void => {
    setShown(on);
    try {
      localStorage.setItem(SHOWN_KEY, on ? '1' : '0');
    } catch {
      // Private storage off: it holds for this card only.
    }
  };
  return [shown, set];
}

/** Copy as ▸ and Save as ▸: the rows (sorted, searched, filtered) in the columns you see. */
function exportItems(t: T, view: View, data: ViewData, say: (text: string, ok: boolean) => void, shown: boolean, setShown: (on: boolean) => void): ActionItem[] {
  const take = (k: ExportKind): { text: string; n: number } => {
    const rows = data.allRows();
    const columns = data.columns.filter((c) => !c.hidden);
    return { text: exportRows(k.format, rows, columns, { shown: shown || !k.raw, name: view.title ?? 'rows' }), n: rows.length };
  };
  const copyAs = (k: ExportKind): void => {
    const { text, n } = take(k);
    copyText(text).then(
      () => say(t('components.views.block.copiedRowsAs', { count: n, format: k.label }), true),
      (err: unknown) => say(t('components.views.block.couldntCopy', { error: err instanceof Error ? err.message : String(err) }), false),
    );
  };
  const saveAs = (k: ExportKind): void => {
    const { text, n } = take(k);
    saveTextAs(exportFileName(view.title, k.ext), text).then(
      (to) => to && say(t('components.views.block.savedRows', { count: n, file: baseName(to) }), true),
      (err: unknown) => say(t('components.views.block.couldntSave', { error: err instanceof Error ? err.message : String(err) }), false),
    );
  };
  const valuesItem: ActionItem = { label: t('components.views.block.valuesShown'), hint: shown ? t('components.views.block.valuesShownHint') : t('components.views.block.valuesRawHint'), checked: shown, separate: true, onSelect: () => setShown(!shown) };
  return [
    { label: t('components.views.block.copyAs'), icon: 'copy', submenu: [...EXPORT_KINDS.map((k) => ({ label: k.label, onSelect: () => copyAs(k) })), valuesItem], onSelect: () => undefined },
    { label: t('components.views.block.saveAs'), icon: 'download', submenu: [...EXPORT_KINDS.map((k) => ({ label: `${k.label}…`, onSelect: () => saveAs(k) })), valuesItem], onSelect: () => undefined },
  ];
}

const label = (t: T, type: ViewType): string => t(`components.views.block.type.${type}`);

function Body({ view, data, shape, full }: { view: View; data: ViewData; shape: Shape; full: boolean }) {
  switch (view.type) {
    case 'stats':
      return <StatTiles view={view} data={data} />;
    case 'code':
      return <CodeView view={view} data={data} />;
    case 'colors':
      return <ColorsView view={view} />;
    case 'gantt':
      return <GanttView view={view} data={data} full={full} />;
    case 'heatmap':
      return <HeatmapView view={view} data={data} />;
    case 'calendar':
      return <CalendarView view={view} data={data} />;
    default:
      if (shape === 'table') return <DataTable view={view} data={data} full={full} />;
      return (
        <Suspense fallback={<div className={v.chartWait} style={{ height: view.height ?? 260 }} />}>
          <Chart view={view} data={data} kind={shape} full={full} />
        </Suspense>
      );
  }
}

const SHAPES = (t: T): ReadonlyArray<{ shape: Shape; icon: IconName; label: string }> => [
  { shape: 'table', icon: 'table', label: t('components.views.block.type.table') },
  { shape: 'line', icon: 'chartLine', label: t('components.views.block.lineChart') },
  { shape: 'area', icon: 'chartArea', label: t('components.views.block.areaChart') },
  { shape: 'bar', icon: 'chartBar', label: t('components.views.block.barChart') },
];

function Head({ view, data, warnings, shape, setShape, copy, more, onExpand, inFull, onClose, bare = false }: { view: View; data: ViewData; warnings: readonly string[]; shape: Shape; setShape?: ((s: Shape) => void) | undefined; copy?: { copied: boolean; onCopy: () => void } | undefined; more?: readonly ActionItem[] | undefined; onExpand?: (() => void) | undefined; inFull?: boolean; onClose?: () => void; bare?: boolean }) {
  const t = useT();
  const actions = useActions();
  const now = useClock(data.at !== undefined, 15_000);
  const live = data.mode === 'live' && Boolean(data.source?.refresh);
  const TitleTag = inFull ? Dialog.Title : 'span';
  return (
    <figcaption className={cx(v.head, bare && v.headBare)}>
      <span className={v.chip} aria-hidden="true">
        <Icon name={ICON[view.type]} size={13} />
      </span>
      <span className={v.titles}>
        <TitleTag className={v.title}>{view.title ?? label(t, view.type)}</TitleTag>
        {view.summary ? <span className={v.summary}>{view.summary}</span> : null}
      </span>
      <span className={v.tools}>
        {warnings.length ? (
          <Tip label={warnings.join('\n')}>
            <span className={v.note}>{t('components.views.block.leftOut', { n: warnings.length })}</span>
          </Tip>
        ) : null}
        {data.mode === 'live' && (data.at || data.loading || live) ? (
          <Tip label={data.at ? t('components.views.block.fetched', { when: new Date(data.at).toLocaleString() }) : t('components.views.block.live')}>
            <span className={cx(v.status, live && v.statusLive, data.loading && v.statusBusy)}>
              <span className={v.dot} />
              {data.loading ? t('components.views.block.loading') : live ? t('components.views.block.live') : data.at ? ago(data.at, now) : t('components.views.block.live')}
            </span>
          </Tip>
        ) : data.mode === 'snapshot' && data.at ? (
          <Tip label={t('components.views.block.snapshotTip')}>
            <span className={v.status}>{ago(data.at, now)}</span>
          </Tip>
        ) : null}
        {setShape ? (
          <span className={v.segment} role="radiogroup" aria-label={t('components.views.block.showAs')}>
            {SHAPES(t).map((s) => (
              <Tip key={s.shape} label={s.label}>
                <button type="button" role="radio" aria-checked={shape === s.shape} aria-label={s.label} className={cx(v.segmentItem, shape === s.shape && v.segmentOn)} onClick={() => setShape(s.shape)}>
                  <Icon name={s.icon} size={12} />
                </button>
              </Tip>
            ))}
          </span>
        ) : null}
        {view.actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={cx(v.action, a.source && data.switched && data.source === a.source && v.actionOn)}
            onClick={() => {
              if (a.source) data.useSource(data.source === a.source ? undefined : a.source);
              else if (a.href) actions.openLink(/^https?:/i.test(a.href) ? { kind: 'url', url: a.href } : { kind: 'local', path: a.href, dir: a.href.endsWith('/') });
              else if (a.copy !== undefined) void copyText(a.copy);
            }}
          >
            {a.href ? <Icon name="external" size={11} /> : a.copy !== undefined ? <Icon name="copy" size={11} /> : null}
            {a.label}
          </button>
        ))}
        {copy ? <IconButton icon={copy.copied ? 'check' : 'copy'} label={copy.copied ? t('components.views.copied') : t('components.views.block.copyTable')} className={cx(v.iconTool, copy.copied && v.iconDone)} onClick={copy.onCopy} /> : null}
        {data.mode === 'live' ? <IconButton icon="refresh" label={t('components.views.block.refresh')} className={cx(v.iconTool, data.loading && v.spinning)} onClick={data.refresh} /> : null}
        {onExpand ? <IconButton icon="expand" label={t('components.views.openFull')} className={v.iconTool} onClick={onExpand} /> : null}
        {more ? (
          <ActionsDropdown items={more}>
            <IconButton icon="more" label={t('components.views.block.copyOrSave')} className={v.iconTool} />
          </ActionsDropdown>
        ) : null}
        {onClose ? (
          <Dialog.Close asChild>
            <IconButton icon="x" label={t('common.close')} keys="esc" className={v.iconTool} />
          </Dialog.Close>
        ) : null}
      </span>
    </figcaption>
  );
}

/** A command Claude wrote by hand (not through its tool) runs once you press Load; after that, by itself. */
function Approve({ command, onRun }: { command: string; onRun: () => void }) {
  const t = useT();
  return (
    <div className={v.approve}>
      <button type="button" className={v.primary} onClick={onRun}>
        <Icon name="play" size={11} />
        {t('components.views.block.load')}
      </button>
      <Tip label={command}>
        <code className={v.approveCode}>{command}</code>
      </Tip>
    </div>
  );
}

function Foot({ view, data }: { view: View; data: ViewData }) {
  const t = useT();
  if (!data.source || view.type === 'colors') return null;
  const kind = data.source.kind;
  return (
    <div className={v.foot}>
      <Icon name={kind === 'http' ? 'globe' : kind === 'folder' ? 'folder' : kind === 'file' ? 'file' : kind === 'command' ? 'terminal' : 'grid'} size={11} />
      <span className={v.sourceText} title={describeSource(data.source)}>
        {/* i18n-ignore: SQLite and Postgres are names */}
        {kind === 'sqlite' ? 'SQLite' : kind === 'postgres' ? 'Postgres' : kind === 'http' ? t('components.views.block.sourceWeb') : kind === 'command' ? t('components.views.block.sourceCommand') : kind === 'folder' ? t('components.views.block.sourceFolder') : t('components.views.block.sourceFile')} · {describeSource(data.source)}
      </span>
      {data.mode === 'snapshot' ? <span className={v.footNote}>{t('components.views.block.liveOnOwner')}</span> : data.source.refresh ? <span className={v.footNote}>{t('components.views.block.every', { s: data.source.refresh })}</span> : null}
    </div>
  );
}

/**
 * A plain Markdown table in an answer (md-table.ts), drawn as a table view: it sorts by its
 * headings, searches when it's long, turns into a chart when it has numbers. Its tools show on hover.
 */
export function MarkdownTable({ node, fallback }: { node: unknown; fallback: React.ReactNode }) {
  const view = useMemo(() => {
    const table = tableRows(node as Parameters<typeof tableRows>[0]);
    return table ? tableView(table) : undefined;
  }, [node]);
  const code = useMemo(() => (view ? JSON.stringify({ type: 'table', data: view.rows }) : ''), [view]);
  return view ? <ViewCard view={view} code={code} warnings={[]} local={false} bare /> : <PlainTable>{fallback}</PlainTable>;
}

/** A table that stays as written (it has links): Copy on hover takes it as drawn, links and all. */
function PlainTable({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { client } = useBeluga();
  const box = useRef<HTMLDivElement>(null);
  const [copied, copy] = useCopied();
  const onCopy = (): void =>
    copy(() => {
      const table = box.current?.querySelector('table');
      if (!table) return Promise.resolve();
      const lines = [...table.rows].map((tr) => [...tr.cells].map((td) => td.innerText.trim()));
      const columns: Column[] = (lines[0] ?? []).map((label, i) => ({ key: String(i), label, type: 'text' }));
      const rows: Row[] = lines.slice(1).map((cells) => Object.fromEntries(cells.map((text, i) => [String(i), text])));
      return copyRich(table.outerHTML, toMarkdownTable(rows, columns)).then(() => toast(client, t('components.views.block.copiedRows', { count: rows.length }), 'success'));
    });
  return (
    <div ref={box} className={v.plainTable}>
      <span className={v.plainTools}>
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? t('components.views.copied') : t('components.views.block.copyTable')} className={cx(v.iconTool, copied && v.iconDone)} onClick={onCopy} />
      </span>
      {children}
    </div>
  );
}
