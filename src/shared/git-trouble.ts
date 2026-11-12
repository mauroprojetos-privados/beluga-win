/**
 * When a push or a GitHub step fails because of how this Mac reaches GitHub (an SSH key GitHub
 * doesn't know, the GitHub CLI missing or logged out, no network…), what it means in plain words
 * and what can fix it (BLG-213). Pure and browser-safe: the daemon classifies, the Mac shows the
 * card, the phone shows the sentence.
 */

import { type Key, type Params, isKey, t, translator } from './i18n/index.js';

/** What went wrong, from git's or gh's own words. */
export type GitTroubleKind =
  /** SSH: GitHub didn't accept this Mac's key ("Permission denied (publickey)", "Could not read from remote repository"). */
  | 'ssh_denied'
  /** SSH: this Mac hasn't met GitHub's server yet, or its fingerprint changed. */
  | 'host_key'
  /** GitHub says the repository isn't there: your account can't see it, or you aren't logged in. */
  | 'no_access'
  /** HTTPS: git has no login for GitHub (or an old password). */
  | 'https_auth'
  /** The GitHub CLI (gh) isn't installed. */
  | 'gh_missing'
  /** The GitHub CLI is installed but not logged in. */
  | 'gh_logged_out'
  /** The project has no GitHub remote to push to. */
  | 'no_remote'
  /** GitHub couldn't be reached at all. */
  | 'offline';

/**
 * A fix the card offers. `push_https`: this one push over HTTPS with gh's login (the remote stays
 * as it is). `use_https`: switch the project's origin to HTTPS for good (asked first). `install_gh`,
 * `gh_login`, `add_ssh_key`, `check_host`: run in Beluga's terminal, so you see it. `retry`: try again.
 * `link`: a page that explains it.
 */
export type GitFixId = 'push_https' | 'use_https' | 'install_gh' | 'gh_login' | 'add_ssh_key' | 'check_host' | 'retry' | 'link';

export interface GitFix {
  readonly id: GitFixId;
  readonly label: string;
  /** One line under it: what it does. */
  readonly detail: string;
  /** `link`: the page. */
  readonly url?: string;
  /** What it types in the terminal, shown as it is. */
  readonly command?: string;
  /** The keys of its label and detail, so a screen says them in its language (sayGitTrouble). */
  readonly words?: { readonly label: string; readonly detail: string; readonly params?: Params };
}

export interface GitTrouble {
  readonly kind: GitTroubleKind;
  /** A short, plain title ("GitHub didn’t accept this Mac’s SSH key"). */
  readonly title: string;
  /** What it means, in a sentence or two. */
  readonly explain: string;
  /** The first is the main action; the rest go behind •••. */
  readonly fixes: readonly GitFix[];
  /** git's or gh's own words, for Details. */
  readonly raw: string;
  /** The keys of its title and explanation (sayGitTrouble). */
  readonly words?: { readonly title: string; readonly explain: string; readonly params?: Params };
}

/** What Beluga knows about this Mac's GitHub setup, to pick the fixes that can work. */
export interface GitSetup {
  /** The GitHub CLI: missing, installed but logged out, logged in, or not known. */
  readonly gh: 'ok' | 'logged_out' | 'missing' | 'unknown';
  /** Homebrew is here (so gh can be installed in one step); its bin folder. */
  readonly brew?: string;
  /** The gh to type in the terminal (its full path when it isn't on the usual PATH). */
  readonly ghCommand?: string;
  /** The origin remote's URL. */
  readonly remote?: string;
}

const GH_CLI_URL = 'https://cli.github.com';
const SSH_DOCS = 'https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account';
const HOST_KEYS_URL = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints';
const ACCESS_DOCS = 'https://docs.github.com/en/repositories/creating-and-managing-repositories/troubleshooting-cloning-errors#error-repository-not-found';
const REMOTE_DOCS = 'https://docs.github.com/en/get-started/getting-started-with-git/managing-remote-repositories';

/** In the order they're checked: a message can match several (SSH ends every refusal with "Could not read from remote repository"). */
const PATTERNS: ReadonlyArray<readonly [GitTroubleKind, RegExp]> = [
  ['gh_missing', /spawn \S*\bgh ENOENT|gh: command not found|command not found: gh|GitHub CLI \(gh\) isn.t installed/i],
  ['gh_logged_out', /gh auth login|To get started with GitHub CLI, please run|not logged in(to)? (to )?any (GitHub )?hosts?|You are not logged into any GitHub hosts|token .*(is )?(invalid|expired)|HTTP 401|Bad credentials/i],
  ['no_remote', /'[^']*' does not appear to be a git repository|No such remote|No configured push destination|no git remotes found|none of the git remotes configured for this repository point to a known GitHub host/i],
  ['offline', /Could not resolve host|Could not resolve hostname|Network is unreachable|Operation timed out|Connection timed out|Connection refused|ssh: connect to host \S+ port \d+|Failed to connect to|error connecting to (api\.)?github\.com|dial tcp|no such host|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i],
  ['host_key', /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|authenticity of host .* can.t be established|No ED25519 host key is known|host key for \S+ has changed/i],
  ['no_access', /Repository not found|Permission to \S+ denied to|HTTP 404|requested URL returned error: 40[34]|Could not resolve to a Repository/i],
  ['https_auth', /Authentication failed for|could not read (Username|Password)|terminal prompts disabled|Invalid username or (password|token)|Support for password authentication was removed|HTTP Basic: Access denied|returned error: 401/i],
  ['ssh_denied', /Permission denied \((publickey|keyboard-interactive)|sign_and_send_pubkey|no mutual signature|Load key .*: (invalid format|bad permissions)|Could not read from remote repository|git@[^:\s]+: Permission denied/i],
];

/** Which kind of trouble git's or gh's words are, or undefined when it's something else (a conflict, a rule…). */
export function classifyGitError(text: string): GitTroubleKind | undefined {
  return PATTERNS.find(([, re]) => re.test(text))?.[0];
}

/** An SSH remote ("git@github.com:me/app.git", "ssh://git@github.com/me/app"). */
export function isSshRemote(url: string | undefined): boolean {
  if (!url) return false;
  return /^ssh:\/\//i.test(url) || /^[\w.-]+@[\w.-]+:/.test(url);
}

/**
 * The HTTPS address of an SSH remote on GitHub (or GitHub Enterprise): "git@github.com:me/app.git"
 * → "https://github.com/me/app.git". Undefined for a host alias from ~/.ssh/config ("github-work"),
 * whose real host Beluga can't know, and for remotes that are already HTTPS.
 */
export function httpsRemoteOf(url: string | undefined): string | undefined {
  if (!url || !isSshRemote(url)) return undefined;
  const m = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url) ?? /^[^@]+@([^:]+):\/?(.+)$/.exec(url);
  if (!m) return undefined;
  const host = m[1]!.toLowerCase() === 'ssh.github.com' ? 'github.com' : m[1]!.toLowerCase();
  if (!host.includes('.')) return undefined;
  const repo = m[2]!.replace(/\/+$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo.replace(/\.git$/, ''))) return undefined;
  return `https://${host}/${repo.endsWith('.git') ? repo : `${repo}.git`}`;
}

/** The host of a remote ("github.com"), for the sentences. */
export function remoteHost(url: string | undefined): string {
  if (!url) return 'github.com';
  const m = /^[a-z]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url) ?? /^[^@]+@([^:]+):/.exec(url);
  return m?.[1]?.toLowerCase() ?? 'github.com';
}

/** Where a key lives, for the SSH fix. */
const SSH_KEY = '~/.ssh/id_ed25519';

// The card's words are made in English (the daemon's message and toasts read them) and carry their
// keys, so a screen says them in the app's language (sayGitTrouble).
const english = translator('en');
type Then = 'https' | 'retry';

/** A fix in English, with the keys of its label and detail. */
function fix(id: GitFixId, label: Key, detail: Key, params?: Params, extra: { readonly url?: string; readonly command?: string } = {}): GitFix {
  return { id, label: english(label, params), detail: english(detail, params), ...extra, words: { label, detail, ...(params ? { params } : {}) } };
}

/** The fixes that set gh up, when it isn't (install it, or log in): undefined once it's logged in. */
function ghSetupFix(setup: GitSetup, then: Then): GitFix | undefined {
  const gh = setup.ghCommand ?? 'gh';
  if (setup.gh === 'missing') {
    if (setup.brew) {
      const brew = `${setup.brew}/brew`;
      return fix('install_gh', 'shared.git.installGh.label', then === 'https' ? 'shared.git.installGh.detailHttps' : 'shared.git.installGh.detailRetry', undefined, { command: `${brew} install gh && ${setup.brew}/gh auth login --web --git-protocol https --hostname ${remoteHost(setup.remote)}` });
    }
    return fix('link', 'shared.git.getGh.label', 'shared.git.getGh.detail', undefined, { url: GH_CLI_URL });
  }
  if (setup.gh === 'logged_out') return fix('gh_login', 'shared.git.ghLogin.label', then === 'https' ? 'shared.git.ghLogin.detailHttps' : 'shared.git.ghLogin.detailRetry', undefined, { command: `${gh} auth login --web --git-protocol https --hostname ${remoteHost(setup.remote)}` });
  return undefined;
}

const retry: GitFix = fix('retry', 'shared.git.retry.label', 'shared.git.retry.detail');

/**
 * git's or gh's error as a card: a plain title, what it means, and the fixes that can work with
 * this Mac's setup (the first is the main action). Undefined when it isn't trouble reaching GitHub.
 */
export function explainGitTrouble(raw: string, setup: GitSetup = { gh: 'unknown' }): GitTrouble | undefined {
  const kind = classifyGitError(raw);
  if (!kind) return undefined;
  const ssh = isSshRemote(setup.remote);
  const https = httpsRemoteOf(setup.remote);
  const host = remoteHost(setup.remote);
  const name = host === 'github.com' ? 'GitHub' : host;
  const gh = setup.ghCommand ?? 'gh';
  const pushHttps: GitFix | undefined = ssh && https ? fix('push_https', 'shared.git.pushHttps.label', 'shared.git.pushHttps.detail') : undefined;
  const useHttps: GitFix | undefined = ssh && https ? fix('use_https', 'shared.git.useHttps.label', 'shared.git.useHttps.detail', { https }) : undefined;
  // Each fix once (two routes can land on the same page).
  const out = (title: Key, explain: Key, params: Params | undefined, fixes: ReadonlyArray<GitFix | undefined>): GitTrouble => ({
    kind,
    title: english(title, params),
    explain: english(explain, params),
    fixes: fixes.filter((f, i, all): f is GitFix => Boolean(f) && all.findIndex((g) => g && (g.id === 'link' ? g.url === f!.url : g.id === f!.id)) === i),
    raw: raw.trim(),
    words: { title, explain, ...(params ? { params } : {}) },
  });
  const notFound = fix('link', 'shared.git.notFound.label', 'shared.git.notFound.detail', undefined, { url: ACCESS_DOCS });

  switch (kind) {
    case 'ssh_denied':
    case 'host_key': {
      const hostKey = kind === 'host_key';
      const sshFix: GitFix = hostKey
        ? fix('check_host', 'shared.git.checkHost.label', 'shared.git.checkHost.detail', { host }, { command: `ssh -T git@${host}` })
        : setup.gh === 'ok'
          ? fix('add_ssh_key', 'shared.git.addKey.label', 'shared.git.addKey.detail', { key: SSH_KEY }, { command: `${gh} auth refresh --hostname ${host} --scopes admin:public_key && { [ -f ${SSH_KEY}.pub ] || ssh-keygen -t ed25519 -f ${SSH_KEY}; } && ${gh} ssh-key add ${SSH_KEY}.pub --title "Beluga on $(scutil --get ComputerName 2>/dev/null || hostname)"` })
          : fix('link', 'shared.git.sshHow.label', 'shared.git.sshHow.detail', undefined, { url: SSH_DOCS });
      const docs: GitFix = hostKey ? fix('link', 'shared.git.fingerprints.label', 'shared.git.fingerprints.detail', undefined, { url: HOST_KEYS_URL }) : fix('link', 'shared.git.sshGuide.label', 'shared.git.sshGuide.detail', undefined, { url: SSH_DOCS });
      // gh logged in: HTTPS works right away. Otherwise gh comes first (and HTTPS after it).
      const setupGh = ghSetupFix(setup, pushHttps ? 'https' : 'retry');
      const fixes = setupGh ? [setupGh, ...(hostKey ? [sshFix] : []), docs, retry] : [pushHttps ?? sshFix, useHttps, ...(pushHttps ? [sshFix] : []), docs, retry];
      return hostKey ? out('shared.git.hostKey.title', 'shared.git.hostKey.explain', { host }, fixes) : out('shared.git.sshDenied.title', 'shared.git.sshDenied.explain', { name }, fixes);
    }
    case 'no_access': {
      const setupGh = ghSetupFix(setup, 'retry');
      if (setupGh) return out('shared.git.noAccessOut.title', 'shared.git.noAccessOut.explain', undefined, [setupGh, pushHttps, notFound, retry]);
      return out('shared.git.noAccess.title', 'shared.git.noAccess.explain', undefined, [
        ssh ? pushHttps : undefined,
        fix('gh_login', 'shared.git.otherAccount.label', 'shared.git.ghLogin.detailRetry', undefined, { command: `${gh} auth login --web --git-protocol https --hostname ${host}` }),
        notFound,
        retry,
      ]);
    }
    case 'https_auth': {
      const setupGh = ghSetupFix(setup, 'retry');
      return out('shared.git.httpsAuth.title', 'shared.git.httpsAuth.explain', { name }, [
        setupGh ?? fix('push_https', 'shared.git.pushLogin.label', 'shared.git.pushLogin.detail'),
        setupGh ? undefined : fix('gh_login', 'shared.git.loginAgain.label', 'shared.git.ghLogin.detailRetry', undefined, { command: `${gh} auth login --web --git-protocol https --hostname ${host}` }),
        retry,
      ]);
    }
    case 'gh_missing':
      return out('shared.git.ghMissing.title', 'shared.git.ghMissing.explain', undefined, [ghSetupFix({ ...setup, gh: 'missing' }, 'retry'), setup.brew ? fix('link', 'shared.git.aboutGh.label', 'shared.git.aboutGh.detail', undefined, { url: GH_CLI_URL }) : undefined, retry]);
    case 'gh_logged_out':
      return out('shared.git.ghLoggedOut.title', 'shared.git.ghLoggedOut.explain', undefined, [ghSetupFix({ ...setup, gh: setup.gh === 'missing' ? 'missing' : 'logged_out' }, 'retry'), retry]);
    case 'no_remote':
      return out('shared.git.noRemote.title', 'shared.git.noRemote.explain', undefined, [fix('link', 'shared.git.remotes.label', 'shared.git.remotes.detail', undefined, { url: REMOTE_DOCS }), retry]);
    case 'offline':
      return out('shared.git.offline.title', ssh ? 'shared.git.offline.explainSsh' : 'shared.git.offline.explain', { name }, [retry, setup.gh === 'ok' ? pushHttps : undefined]);
  }
}

/** A word whose key this screen knows, in the app's language; else as it was sent. */
const said = (text: string, key: string | undefined, params?: Params): string => (key && isKey(key) ? t(key, params) : text);

/** The card in the app's language (a card from an older daemon, with no keys, as it was sent). */
export function sayGitTrouble(trouble: GitTrouble): GitTrouble {
  const w = trouble.words;
  return {
    ...trouble,
    ...(w ? { title: said(trouble.title, w.title, w.params), explain: said(trouble.explain, w.explain, w.params) } : {}),
    fixes: trouble.fixes.map((f) => (f.words ? { ...f, label: said(f.label, f.words.label, f.words.params), detail: said(f.detail, f.words.detail, f.words.params) } : f)),
  };
}

/** The card in one line, for a toast or the phone: "GitHub didn’t accept this Mac’s SSH key. Fix it on your Mac." */
export const troubleLine = (tr: GitTrouble): string => `${tr.title}. ${tr.fixes.length > 1 || tr.fixes[0]?.id !== 'retry' ? 'See how to fix it in Beluga on your Mac' : 'Try again in a moment'}.`;
