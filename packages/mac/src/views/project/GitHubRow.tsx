import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@beluga/workspaces/github.js';
import type { ActionItem } from '../../components/SpecMenu.js';
import { useApi } from '../../lib/beluga.js';
import type { GitHubInfo } from '@beluga/workspaces/github.js';
import { CommandLine, FormSheet } from '../../components/FormSheet.js';
import { Icon } from '../../components/Icon.js';
import { Button, IconButton, Tip, cx } from '../../components/ui.js';
import { openExternal } from '../../lib/system.js';
import { useGitHub } from '../history/use-history.js';
import s from './main-sync.module.css';
import { useT } from '../../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';

const compact = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** The GitHub CLI isn't set up (or can't see this repository): how to set it up, then check again (also Issues'). */
export function ConnectGitHub({ onCheck, onClose }: { onCheck: () => Promise<boolean>; onClose: () => void }) {
  const t = useT();
  return (
    <FormSheet
      title={t('project.github.connect')}
      icon="pr"
      intro={t('project.github.intro')}
      submitLabel={t('project.github.checkAgain')}
      onSubmit={async () => ((await onCheck()) ? onClose() : t('project.github.stillNoAnswer'))}
      onCancel={onClose}
    >
      <div className={s.ghSteps}>
        <div>
          <div className={s.ghStepTitle}>{t('project.github.install')} <span>{t('project.github.needsHomebrew')}</span></div>
          <CommandLine command="brew install gh" />
        </div>
        <div>
          <div className={s.ghStepTitle}>{t('project.github.signIn')} <span>{t('project.github.opensBrowser')}</span></div>
          <CommandLine command="gh auth login" />
        </div>
      </div>
    </FormSheet>
  );
}

function Pills({ info, url }: { info: GitHubInfo; url: string }) {
  const t = useT();
  const visibility = info.visibility === 'private' ? t('project.github.private') : info.visibility === 'internal' ? t('project.github.internal') : t('project.github.public');
  return (
    <>
      <Tip label={info.archived ? t('project.github.archivedTip', { visibility }) : t('project.github.repository', { visibility })}>
        <span className={cx(s.ghPill, info.visibility !== 'public' && s.ghPrivate)}>
          <Icon name={info.visibility === 'public' ? 'globe' : 'lock'} size={11} />
          {visibility}
          {info.archived ? ` · ${t('project.github.archived')}` : ''}
        </span>
      </Tip>
      {info.people !== undefined ? (
        <Tip label={info.peopleKind === 'collaborators' ? t('project.github.collaboratorsTip') : t('project.github.contributorsTip')}>
          <button type="button" className={s.ghPill} onClick={() => void openExternal(`${url}/${info.peopleKind === 'collaborators' ? 'settings/access' : 'graphs/contributors'}`)}>
            <Icon name="people" size={11} />
            {t(info.peopleKind === 'collaborators' ? 'project.github.people' : 'project.github.contributors', { count: info.people })}
          </button>
        </Tip>
      ) : null}
      {info.openPrs !== undefined ? (
        <Tip label={t('project.github.openPullRequests')}>
          <button type="button" className={s.ghPill} onClick={() => void openExternal(`${url}/pulls`)}>
            <Icon name="pr" size={11} />
            {info.openPrsMore ? t('project.github.openPrsMore', { n: info.openPrs }) : t('project.github.openPrs', { count: info.openPrs })}
          </button>
        </Tip>
      ) : null}
      <Tip label={`${t('project.github.stars', { count: info.stars })} · ${t('project.github.forks', { count: info.forks })} · ${t('project.github.openIssues', { count: info.openIssues })}`}>
        <span className={s.ghPill}>★ {compact(info.stars)}</span>
      </Tip>
    </>
  );
}

/** The project's GitHub page and what GitHub says about it, in a row of pills (hidden for other remotes). */
export function GitHubRow({ projectId }: { projectId: string }) {
  const { state, refresh, loading } = useGitHub(projectId);
  const [connect, setConnect] = useState(false);
  const t = useT();
  if (state?.kind !== 'github') return null;
  const { repo, info } = state;
  return (
    // i18n-ignore
    <div className={s.ghRow} role="group" aria-label="GitHub">
      <Tip label={repo.url}>
        <Button size="small" icon="external" onClick={() => void openExternal(repo.url)}>
          GitHub{/* i18n-ignore */}
        </Button>
      </Tip>
      {info ? (
        <Pills info={info} url={repo.url} />
      ) : (
        <button type="button" className={s.link} onClick={() => setConnect(true)}>
          {t('project.github.connectForDetails')}
        </button>
      )}
      {info ? <IconButton icon="refresh" label={loading ? t('project.github.asking') : t('project.github.askAgain')} className={cx(s.ghRefresh, loading && s.spinning)} onClick={() => void refresh()} /> : null}
      {connect ? (
        <ConnectGitHub
          onClose={() => setConnect(false)}
          onCheck={async () => {
            const now = await refresh();
            return now?.kind === 'github' && Boolean(now.info);
          }}
        />
      ) : null}
    </div>
  );
}

const repos = new Map<string, Promise<GitHubRepo | undefined>>();

/** "Open on GitHub" for a project's menu (only when its remote is on GitHub; read from the remote, no network). */
export function useGitHubMenuItems(projectId: string, hasRoot: boolean): ActionItem[] {
  const api = useApi();
  const [repo, setRepo] = useState<GitHubRepo>();
  useEffect(() => {
    if (!hasRoot) return;
    let alive = true;
    const job = repos.get(projectId) ?? api.git.githubRepo(projectId);
    repos.set(projectId, job);
    job.then(
      (r) => alive && setRepo(r ?? undefined),
      () => repos.delete(projectId),
    );
    return () => {
      alive = false;
    };
  }, [projectId, hasRoot]);
  return repo ? [{ label: t('project.github.openOnGitHub'), icon: 'external', hint: repo.url, onSelect: () => void openExternal(repo.url) }] : [];
}
