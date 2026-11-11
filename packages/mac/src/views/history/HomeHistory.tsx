import { Button, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApp } from '../../lib/beluga.js';
import { useLateArrival } from '../../lib/last-seen.js';
import { HistoryList } from './HistoryList.js';
import { useRefContext } from './HistoryView.js';
import { showCommitNext } from './history-nav.js';
import { useHistoryVersion, useLog } from './use-history.js';
import h from '../project-home.module.css';
import s from './history.module.css';
import a from '../../lib/arrive.module.css';
import { useT } from '../../lib/i18n.js';

const LATEST = 15;
const QUERY = { branch: 'default' } as const;

/**
 * The project home's History: the latest commits on the default branch and its upstream (what
 * "N behind" brings in shows as incoming), and the way to all of it.
 */
export function HomeHistory({ projectId }: { projectId: string }) {
  const t = useT();
  const actions = useActions();
  const project = useApp((st) => st.projects.find((p) => p.id === projectId && p.root));
  const version = useHistoryVersion(project);
  const log = useLog(projectId, QUERY, LATEST, version);
  const refs = useRefContext(projectId, project?.sync?.current);
  // Kept from last time: shown still. Read for the first time: it settles in once it's here.
  const late = useLateArrival(projectId, log.commits.length > 0);
  const open = (hash?: string): void => {
    if (hash) showCommitNext(projectId, hash);
    actions.run({ type: 'view', view: { kind: 'project', id: projectId, page: 'history' } });
  };
  if (!log.commits.length && !log.loading) return null;
  const incoming = log.commits.filter((c) => c.incoming).length;
  return (
    <section className={h.section} aria-label={t('views.homeHistory.title')}>
      <div className={h.sectionHead}>
        <h3 className={h.sectionTitle}>{t('views.homeHistory.title')}</h3>
        {incoming ? <span className={h.sectionHint}>{t('views.homeHistory.incoming', { count: incoming, upstream: project?.sync?.upstream ?? t('views.homeHistory.theRemote') })}</span> : <span className={h.sectionHint}>{project?.sync?.upstream ? t('views.homeHistory.and', { branch: project.sync.branch ?? 'main', upstream: project.sync.upstream }) : (project?.sync?.branch ?? 'main')}</span>}
        <span className={h.flex} />
        <Button size="small" variant="quiet" icon="clock" onClick={() => open()}>
          {t('views.homeHistory.showAll')}
        </Button>
      </div>
      {log.commits.length ? (
        <div className={cx(s.homeList, late && a.arrive)}>
          <HistoryList commits={log.commits} variant="full" onSelect={(hash) => open(hash)} refs={refs} label={t('views.homeHistory.latest')} />
        </div>
      ) : (
        <p className={h.none}>{t('views.history.reading')}</p>
      )}
    </section>
  );
}
