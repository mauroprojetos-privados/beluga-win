import { useEffect, useState } from 'react';
import type { Sentinel } from '@beluga/core/sentinel/model.js';
import { sizeWords } from '@beluga/core/sentinel/columns.js';
import { Icon } from '../components/Icon.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { IconButton } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import { ago } from '../tasks/tasks-model.js';
import { useSentinelActions } from './use-sentinel.js';
import tk from '../tasks/tasks.module.css';
import s from './sentinel.module.css';
import d from './data.module.css';
import { revealLabel } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';
import { formatNumber } from '@beluga/shared/i18n/format.js';

type Data = Awaited<ReturnType<ReturnType<typeof useSentinelActions>['api']['dataList']>>;

/** Runs shown at first (the rest a click away). */
const FIRST_RUNS = 6;
const KIND_WORDS: Readonly<Record<string, 'sentinel.dataCard.kind.number' | 'sentinel.dataCard.kind.rows' | 'sentinel.dataCard.kind.series' | 'sentinel.dataCard.kind.output'>> = { number: 'sentinel.dataCard.kind.number', rows: 'sentinel.dataCard.kind.rows', series: 'sentinel.dataCard.kind.series', output: 'sentinel.dataCard.kind.output' };

/**
 * Kept data (BLG-392): everything a sentinel keeps, to look at and take out. Each metric with how
 * much of it is kept (a number's every run, a table's rows run by run, a kept output's last ones)
 * opens its whole history, with Export (CSV or JSON, to Downloads) and Show in Finder; each run that
 * kept files lists them (its report, each step's output, the documents its tables hold), and one
 * opens in Beluga's viewer. Below the History, when it keeps anything.
 */
export function DataCard({ item }: { item: Sentinel }) {
  const t = useT();
  const a = useSentinelActions();
  const [data, setData] = useState<Data>();
  const [all, setAll] = useState(false);
  // Read again when a run ends (it may have kept more).
  const last = useApp((st) => st.sentinel.runs.filter((r) => r.sentinelId === item.id).reduce((n, r) => Math.max(n, r.endedAt ?? 0), 0));
  useEffect(() => {
    let alive = true;
    a.api.dataList(item.id).then(
      (got) => alive && setData(got),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [a, item.id, last]);
  if (!data || (!data.metrics.length && !data.runs.length)) return null;
  const runs = all ? data.runs : data.runs.slice(0, FIRST_RUNS);
  return (
    <section className={s.card} aria-label={t('sentinel.data.kept')} data-testid="sentinel-data">
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{t('sentinel.data.kept')}</h3>
        <span className={tk.grow} />
        <span className={s.hint}>{t('sentinel.dataCard.keptDays', { count: data.keepsDays })}</span>
        {data.metrics.length ? <IconButton icon="folder" label={revealLabel('its numbers')} onClick={() => void a.act(() => a.api.dataReveal(item.id))} /> : null}
      </header>
      {data.metrics.length ? (
        <div className={d.list} role="list" aria-label={t('sentinel.dataCard.whatKeeps')}>
          {data.metrics.map((m) => (
            <button key={m.name} type="button" role="listitem" className={d.row} data-metric={m.name} onClick={() => openSheet({ kind: 'sentinel_data', sentinelId: item.id, metric: m.name })}>
              <Icon name={m.kind === 'rows' ? 'table' : m.kind === 'output' ? 'file' : m.kind === 'series' ? 'chartBar' : 'chartLine'} size={13} className={d.icon} />
              <span className={d.name}>{m.label}</span>
              <span className={d.what}>{KIND_WORDS[m.kind] ? t(KIND_WORDS[m.kind]!) : m.kind}</span>
              <span className={d.count}>
                {m.kind === 'rows' ? t('sentinel.dataCard.rowsOver', { rows: formatNumber(m.rows ?? 0), runs: t('sentinel.data.runs', { count: m.lines, n: formatNumber(m.lines) }) }) : t('sentinel.data.runs', { count: m.lines, n: formatNumber(m.lines) })}
                {m.first ? t('sentinel.dataCard.since', { ago: ago(m.first) }) : ''}
              </span>
              <Icon name="chevronRight" size={12} className={d.more} />
            </button>
          ))}
        </div>
      ) : null}
      {data.runs.length ? (
        <>
          <h4 className={d.sub}>{t('sentinel.dataCard.files')}</h4>
          <div className={d.list} role="list" aria-label={t('sentinel.dataCard.files')}>
            {runs.map((r) => (
              <div key={r.runId} role="listitem" className={d.runRow} data-run={r.runId}>
                <button type="button" className={d.runWhen} onClick={() => a.openRun(r.runId)} title={t('sentinel.dash.openTheRun')}>
                  {ago(r.at)}
                </button>
                <span className={d.files}>
                  {r.files.map((f) => (
                    <button key={f.name} type="button" className={d.file} title={`${f.label} · ${sizeWords(f.size)}`} onClick={() => openSheet({ kind: 'sentinel_document', source: 'run', sentinelId: item.id, metric: r.runId, column: '', name: f.name })}>
                      <Icon name={f.kind === 'report' ? 'book' : f.kind === 'step' ? 'terminal' : 'file'} size={11} />
                      <span>{f.label}</span>
                    </button>
                  ))}
                </span>
                <ActionsDropdown
                  items={[
                    { label: t('sentinel.dataCard.saveFiles'), icon: 'download', onSelect: () => void a.act(() => a.api.dataExport(item.id, { runId: r.runId }), t('sentinel.data.saved')) },
                    { label: revealLabel(), icon: 'folder', onSelect: () => void a.act(() => a.api.dataReveal(item.id, r.runId)) },
                  ]}
                >
                  <IconButton icon="more" label={t('sentinel.run.moreForRun')} />
                </ActionsDropdown>
              </div>
            ))}
          </div>
          {data.runs.length > FIRST_RUNS ? (
            <button type="button" className={d.showAll} onClick={() => setAll(!all)}>
              {all ? t('sentinel.dataCard.fewer') : t('sentinel.dataCard.allRuns', { count: data.runs.length })}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
