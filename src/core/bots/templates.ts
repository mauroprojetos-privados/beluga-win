import { botFileText } from './schema.js';

/**
 * Bot Studio's templates (docs/bots.md, Phase 6c): a starting bot you adjust. Each is the files a
 * bot's folder holds, applied like a Create with Claude draft (a diff you accept). Browser-safe.
 * Their MCPs name secrets as ${env:NAME}; you set the values under Tools › Secrets.
 */

export interface BotTemplate {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly files: Readonly<Record<string, string>>;
}

const skill = (name: string, description: string, body: string): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;

export const BOT_TEMPLATES: readonly BotTemplate[] = [
  {
    id: 'supabase',
    name: 'Supabase',
    summary: 'Schema, RLS and migrations, with the Supabase MCP',
    files: {
      'bot.json': botFileText({ version: 1, name: 'Supa', icon: 'table', description: 'Supabase: schema, row level security and migrations' }),
      'CLAUDE.md': '# Supa\n\nYou only look after Supabase: the schema, row level security (RLS), migrations and edge functions.\n\n- Every table gets RLS on, with a policy per organization.\n- Migrations are files under `supabase/migrations/`, tested locally and reversible.\n- Never run anything against production without the owner’s yes.\n- Search your knowledge before answering from memory.\n',
      '.mcp.json': `${JSON.stringify({ mcpServers: { supabase: { command: 'npx', args: ['-y', '@supabase/mcp-server-supabase@latest', '--read-only'], env: { SUPABASE_ACCESS_TOKEN: '${env:SUPABASE_ACCESS_TOKEN}' } } } }, null, 2)}\n`,
      '.claude/skills/supabase-migrations/SKILL.md': skill('supabase-migrations', 'How to write, test and roll back a Supabase migration', '1. `supabase migration new <name>`.\n2. Write the SQL, with its RLS policies.\n3. `supabase db reset` locally, then the tests.\n4. Write the down migration beside it.'),
      '.claude/skills/supabase-rls/SKILL.md': skill('supabase-rls', 'Row level security patterns for multi-tenant tables', '- `alter table … enable row level security;`\n- A policy per role reading `auth.uid()` and the organization membership table.\n- Test with two users of different organizations.'),
    },
  },
  {
    id: 'expo',
    name: 'Expo / Android',
    summary: 'Builds, signing and release of an Expo app',
    files: {
      'bot.json': botFileText({ version: 1, name: 'Expo', icon: 'phone', description: 'Expo and Android: builds, signing, releases' }),
      'CLAUDE.md': '# Expo\n\nYou look after the Expo app’s builds and releases: EAS and Gradle builds, signing keys, version codes and store releases.\n\n- Never commit a keystore or its password.\n- Raise `android.versionCode` on every release.\n- When a build fails, read the whole Gradle log before guessing.\n',
      '.claude/skills/android-release/SKILL.md': skill('android-release', 'Build and sign an Android release of the Expo app', '1. Raise the version code in app.json.\n2. Build with the project’s own release script.\n3. Check the APK’s signature before attaching it.'),
    },
  },
  {
    id: 'deploy',
    name: 'Deploy',
    summary: 'Ship to staging and production from runbooks',
    files: {
      'bot.json': botFileText({ version: 1, name: 'Juno', icon: 'server', description: 'Deploys: staging and production, from the runbooks', autonomy: 'ask' }),
      'CLAUDE.md': '# Juno\n\nYou deploy: to staging first, then to production on the owner’s yes. You follow the runbook in your knowledge step by step and report each step.\n\n- Never deploy to production without an explicit yes in this chat.\n- Before a deploy, check the CI is green and the migration plan is known.\n- After it, check the health endpoints and the logs.\n',
      '.claude/skills/deploy-staging/SKILL.md': skill('deploy-staging', 'Deploy the current main to staging and check it', '1. Check CI on main.\n2. Run the deploy command from the runbook.\n3. Hit the health endpoint and read the last 100 log lines.'),
    },
  },
  {
    id: 'reviewer',
    name: 'PR reviewer',
    summary: 'Reviews pull requests against the house rules',
    files: {
      'bot.json': botFileText({ version: 1, name: 'Rev', icon: 'review', description: 'Reviews pull requests against the project’s rules' }),
      'CLAUDE.md': '# Rev\n\nYou review pull requests. You read the diff and the project’s rules (its CLAUDE.md, its docs), and report what’s wrong, by file and line, most serious first. You never push or merge.\n\n- Correctness first, then security, then tests, then style.\n- Say what you checked and found nothing in, too.\n',
      '.claude/skills/review-checklist/SKILL.md': skill('review-checklist', 'The checklist for reviewing a pull request', '- Does it do what its description says?\n- Are errors handled, and inputs checked?\n- Are there tests for the new paths?\n- Did docs and the changelog follow?'),
    },
  },
];
