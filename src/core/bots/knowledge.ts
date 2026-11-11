import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { isSecretPath } from '../shares.js';
import type { KnowledgeBackend } from './schema.js';
import { KNOWLEDGE_DIR, KNOWLEDGE_JSON } from './folder.js';

/**
 * A bot's knowledge (docs/bots.md, Phase 6b): documentation, runbooks and notes, searched by
 * passage and never pasted whole. Its sources are listed in `knowledge.json` and copied into
 * `knowledge/` (so the folder carries them, and exports them). Search goes to OpenViking when it
 * runs here (`ov`, its index under viking://resources/beluga-bots/<id>/), else to a plain local
 * full-text index kept beside them (`.index/`, never committed or exported). Either way a bot
 * searches only its own sources: the tool is made per bot, with that bot's folder.
 *
 * Secrets never go in: a file `isSecretPath` calls a secret (a .env, a key) is refused when added
 * and skipped when indexed, and nothing in knowledge/ reaches the phone (all of ~/.beluga is secret
 * to it).
 */

const run = promisify(execFile);

/** The most a knowledge file holds, and how many sources a bot keeps. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCES = 200;

/** Text the index reads (a PDF or an image isn't text: OpenViking reads those, the local index doesn't). */
const TEXT_EXT = /\.(md|mdx|markdown|txt|text|rst|adoc|json|ya?ml|toml|ini|csv|tsv|html?|xml|sql|sh|bash|zsh|ps1|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|js|jsx|mjs|cjs|ts|tsx|vue|svelte|css|scss|graphql|gql|proto|tf|env\.example|log)$/i;

export const Source = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,48}$/),
  kind: z.enum(['file', 'url', 'text']),
  /** Its name as shown ("Supabase RLS guide"). */
  name: z.string().min(1).max(200),
  /** Where it came from: a path on this computer or a URL (none for text you pasted). */
  origin: z.string().max(2000).optional(),
  /** Its copy, relative to the folder ("knowledge/supabase-rls.md"). */
  file: z.string().max(400),
  size: z.number().int().min(0),
  addedAt: z.number().int().min(0),
});
export type Source = z.infer<typeof Source>;

export const KnowledgeFile = z.object({
  version: z.literal(1),
  sources: z.array(Source).max(MAX_SOURCES),
  /** When it was last indexed, and where. */
  indexed: z.object({ at: z.number().int().min(0), backend: z.enum(['openviking', 'local']), chunks: z.number().int().min(0), skipped: z.array(z.string().max(400)).max(200).optional() }).optional(),
});
export type KnowledgeFile = z.infer<typeof KnowledgeFile>;

const EMPTY: KnowledgeFile = { version: 1, sources: [] };

export interface Passage {
  readonly source: string;
  readonly file: string;
  readonly text: string;
  readonly score: number;
}

// ------------------------------------------------------------------ the local index

interface Chunk {
  readonly file: string;
  readonly source: string;
  readonly text: string;
  readonly terms: Readonly<Record<string, number>>;
  readonly len: number;
}

interface LocalIndex {
  readonly v: 1;
  readonly chunks: readonly Chunk[];
  readonly df: Readonly<Record<string, number>>;
  readonly avg: number;
}

const INDEX_FILE = path.join('.index', 'knowledge.json');
const CHUNK = 900;
const OVERLAP = 150;

/** Words as the index counts them: lowercase letters and digits, accents folded, 2+ characters. */
export function termsOf(text: string): string[] {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .match(/[a-z0-9_]{2,}/g) ?? []
  );
}

/** A text in passages of about CHUNK characters, overlapping, cut at a paragraph or a line where it can. */
export function chunksOf(text: string): string[] {
  const out: string[] = [];
  const clean = text.replace(/\r\n/g, '\n');
  let at = 0;
  while (at < clean.length) {
    let end = Math.min(clean.length, at + CHUNK);
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n\n', end);
      const line = clean.lastIndexOf('\n', end);
      if (para > at + CHUNK / 2) end = para;
      else if (line > at + CHUNK / 2) end = line;
    }
    const piece = clean.slice(at, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    at = Math.max(end - OVERLAP, at + 1);
  }
  return out;
}

function buildIndex(docs: ReadonlyArray<{ readonly file: string; readonly source: string; readonly text: string }>): LocalIndex {
  const chunks: Chunk[] = [];
  const df: Record<string, number> = {};
  for (const d of docs) {
    for (const piece of chunksOf(d.text)) {
      const terms: Record<string, number> = {};
      const words = termsOf(piece);
      for (const w of words) terms[w] = (terms[w] ?? 0) + 1;
      for (const w of Object.keys(terms)) df[w] = (df[w] ?? 0) + 1;
      chunks.push({ file: d.file, source: d.source, text: piece, terms, len: words.length });
    }
  }
  const avg = chunks.length ? chunks.reduce((n, c) => n + c.len, 0) / chunks.length : 0;
  return { v: 1, chunks, df, avg };
}

/** BM25 over the passages: the best `limit`, best first. */
export function searchIndex(index: Pick<LocalIndex, 'chunks' | 'df' | 'avg'>, query: string, limit: number): Passage[] {
  const q = [...new Set(termsOf(query))];
  if (!q.length || !index.chunks.length) return [];
  const N = index.chunks.length;
  const k1 = 1.2;
  const b = 0.75;
  const scored = index.chunks.map((c) => {
    let score = 0;
    for (const t of q) {
      const f = c.terms[t];
      if (!f) continue;
      const n = index.df[t] ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * c.len) / (index.avg || 1)));
    }
    return { c, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit)
    .map(({ c, score }) => ({ source: c.source, file: c.file, text: c.text, score: Math.round(score * 100) / 100 }));
}

// ------------------------------------------------------------------ OpenViking

/** OpenViking's command line here (`ov`), when it's installed and its server answers. */
export interface Viking {
  readonly bin: string;
}

/** Where OpenViking keeps a bot's sources. */
const vikingUri = (botId: string): string => `viking://resources/beluga-bots/${botId}`;

/**
 * OpenViking, if it runs here: `ov health` answers. $BELUGA_OPENVIKING names its `ov` (or "off");
 * otherwise `ov` on the PATH or in ~/.local/bin. Checked again at most once a minute.
 */
export async function findViking(env: NodeJS.ProcessEnv = process.env, home = env.HOME ?? env.USERPROFILE ?? ''): Promise<Viking | undefined> {
  const set = env.BELUGA_OPENVIKING?.trim();
  if (set === 'off') return undefined;
  const now = Date.now();
  if (vikingSeen && now - vikingSeen.at < 60_000 && vikingSeen.key === set) return vikingSeen.found;
  const tries = set ? [set] : ['ov', ...(home ? [path.join(home, '.local', 'bin', 'ov')] : [])];
  let found: Viking | undefined;
  for (const bin of tries) {
    try {
      await run(bin, ['health'], { timeout: 8000, windowsHide: true });
      found = { bin };
      break;
    } catch {
      // Not installed, or its server isn't set up (`openviking-server init`) or running.
    }
  }
  vikingSeen = { at: now, key: set, found };
  return found;
}
let vikingSeen: { at: number; key: string | undefined; found: Viking | undefined } | undefined;

/** The JSON `ov find -o json` prints → passages (its shape varies by version: read loosely). */
export function vikingPassages(out: string, limit: number): Passage[] {
  let raw: unknown;
  try {
    raw = JSON.parse(out);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? ((raw as Record<string, unknown>).results ?? (raw as Record<string, unknown>).resources ?? (raw as Record<string, unknown>).data) : undefined;
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).flatMap((r): Passage[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const text = [o.content, o.abstract, o.overview, o.text].find((x): x is string => typeof x === 'string' && x.trim().length > 0);
    const uri = typeof o.uri === 'string' ? o.uri : '';
    if (!text) return [];
    return [{ source: uri.split('/').pop() || uri || 'OpenViking', file: uri, text: text.slice(0, 2000), score: typeof o.score === 'number' ? o.score : 0 }];
  });
}

// ------------------------------------------------------------------ one bot's knowledge

export class Knowledge {
  constructor(
    readonly dir: string,
    readonly botId: string,
    private readonly viking: () => Promise<Viking | undefined> = () => findViking(),
  ) {}

  private at(rel: string): string {
    return path.join(this.dir, rel);
  }

  read(): KnowledgeFile {
    try {
      const parsed = KnowledgeFile.safeParse(JSON.parse(readFileSync(this.at(KNOWLEDGE_JSON), 'utf8')));
      return parsed.success ? parsed.data : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  private write(file: KnowledgeFile): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.at(KNOWLEDGE_JSON)}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.at(KNOWLEDGE_JSON));
  }

  /** A name for a copy that isn't taken: "supabase-rls.md", then "supabase-rls-2.md". */
  private freeName(base: string): string {
    const ext = path.extname(base) || '.md';
    const stem = (path.basename(base, path.extname(base)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source').slice(0, 40);
    let name = `${stem}${ext.toLowerCase()}`;
    for (let i = 2; existsSync(this.at(path.join(KNOWLEDGE_DIR, name))); i++) name = `${stem}-${i}${ext.toLowerCase()}`;
    return name;
  }

  private add(kind: Source['kind'], name: string, copy: (dest: string) => number, origin?: string): Source {
    const file = this.read();
    if (file.sources.length >= MAX_SOURCES) throw new Error(`A bot keeps up to ${MAX_SOURCES} sources: remove some first`);
    const fileName = this.freeName(origin && kind === 'file' ? path.basename(origin) : `${name}.md`);
    const rel = `${KNOWLEDGE_DIR}/${fileName}`;
    mkdirSync(this.at(KNOWLEDGE_DIR), { recursive: true, mode: 0o700 });
    const size = copy(this.at(rel));
    const id = fileName.replace(/\.[^.]+$/, '').slice(0, 48) || 'source';
    const source: Source = { id, kind, name: name.slice(0, 200), ...(origin ? { origin } : {}), file: rel, size, addedAt: Date.now() };
    this.write({ ...file, sources: [...file.sources.filter((s) => s.id !== id), source] });
    return source;
  }

  /** A file of yours, copied in. Never a secret, nothing over MAX_SOURCE_BYTES. */
  addFile(abs: string, name?: string): Source {
    if (isSecretPath(abs)) throw new Error(`${path.basename(abs)} looks like a secret (a key, a .env): it never goes into a bot’s knowledge`);
    const st = statSync(abs);
    if (!st.isFile()) throw new Error(`${abs} isn’t a file`);
    if (st.size > MAX_SOURCE_BYTES) throw new Error(`${path.basename(abs)} is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
    return this.add('file', name ?? path.basename(abs), (dest) => {
      copyFileSync(abs, dest);
      return st.size;
    }, abs);
  }

  /** Words you pasted, as a source of their own. */
  addText(name: string, text: string): Source {
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_SOURCE_BYTES) throw new Error(`That text is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
    return this.add('text', name, (dest) => {
      writeFileSync(dest, text, { mode: 0o600 });
      return bytes;
    });
  }

  /** A page on the web, fetched now and kept as text (its HTML's tags taken out). */
  async addUrl(url: string, fetcher: typeof fetch = fetch): Promise<Source> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error('That isn’t a web address');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Use an http:// or https:// address');
    const res = await fetcher(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${u.host} answered ${res.status}`);
    const body = (await res.text()).slice(0, MAX_SOURCE_BYTES);
    const html = /html/i.test(res.headers.get('content-type') ?? '') || /^\s*<(!doctype|html)/i.test(body);
    const text = html ? htmlText(body) : body;
    const title = (html ? /<title[^>]*>([^<]{1,200})<\/title>/i.exec(body)?.[1]?.trim() : undefined) || `${u.host}${u.pathname}`.replace(/\/$/, '');
    return this.add('url', title, (dest) => {
      writeFileSync(dest, `<!-- ${u.href} -->\n${text}`, { mode: 0o600 });
      return Buffer.byteLength(text);
    }, u.href);
  }

  remove(id: string): void {
    const file = this.read();
    const s = file.sources.find((x) => x.id === id);
    if (!s) return;
    if (s.file.startsWith(`${KNOWLEDGE_DIR}/`) && !s.file.includes('..')) rmSync(this.at(s.file), { force: true });
    this.write({ ...file, sources: file.sources.filter((x) => x.id !== id) });
  }

  /** The texts the index reads: each source's copy, skipping secrets and what isn't text. */
  private docs(file: KnowledgeFile): { docs: Array<{ file: string; source: string; text: string }>; skipped: string[] } {
    const docs: Array<{ file: string; source: string; text: string }> = [];
    const skipped: string[] = [];
    for (const s of file.sources) {
      const abs = this.at(s.file);
      if (isSecretPath(abs) || (s.origin && s.kind === 'file' && isSecretPath(s.origin))) {
        skipped.push(`${s.name}: a secret`);
        continue;
      }
      if (s.kind === 'file' && !TEXT_EXT.test(s.file)) {
        skipped.push(`${s.name}: not text (OpenViking reads it; the local index doesn’t)`);
        continue;
      }
      try {
        docs.push({ file: s.file, source: s.name, text: readFileSync(abs, 'utf8') });
      } catch {
        skipped.push(`${s.name}: its copy is missing`);
      }
    }
    return { docs, skipped };
  }

  /**
   * Index every source again: into OpenViking when it runs here (each copy added under the bot's own
   * viking:// folder), and always into the local index too (the fallback when OpenViking stops).
   */
  async reindex(): Promise<NonNullable<KnowledgeFile['indexed']>> {
    const file = this.read();
    const { docs, skipped } = this.docs(file);
    const index = buildIndex(docs);
    mkdirSync(path.dirname(this.at(INDEX_FILE)), { recursive: true, mode: 0o700 });
    writeFileSync(this.at(INDEX_FILE), JSON.stringify(index), { mode: 0o600 });
    let backend: KnowledgeBackend = 'local';
    const viking = await this.viking();
    if (viking && file.sources.length) {
      try {
        await run(viking.bin, ['rm', vikingUri(this.botId), '-r'], { timeout: 60_000, windowsHide: true }).catch(() => undefined);
        for (const s of file.sources) {
          if (isSecretPath(this.at(s.file))) continue;
          await run(viking.bin, ['add-resource', this.at(s.file), '-p', vikingUri(this.botId), '--wait'], { timeout: 300_000, windowsHide: true });
        }
        backend = 'openviking';
      } catch {
        backend = 'local';
      }
    }
    const indexed = { at: Date.now(), backend, chunks: index.chunks.length, ...(skipped.length ? { skipped } : {}) };
    this.write({ ...file, indexed });
    return indexed;
  }

  private local(): LocalIndex | undefined {
    try {
      const raw = JSON.parse(readFileSync(this.at(INDEX_FILE), 'utf8')) as LocalIndex;
      return raw?.v === 1 && Array.isArray(raw.chunks) ? raw : undefined;
    } catch {
      return undefined;
    }
  }

  /** Where a search goes now. */
  async backend(): Promise<KnowledgeBackend> {
    return this.read().indexed?.backend === 'openviking' && (await this.viking()) ? 'openviking' : 'local';
  }

  /** The passages that match, best first, and where they were searched. */
  async search(query: string, limit = 6): Promise<{ readonly passages: readonly Passage[]; readonly backend: KnowledgeBackend }> {
    const file = this.read();
    if (!file.sources.length) return { passages: [], backend: 'local' };
    if (file.indexed?.backend === 'openviking') {
      const viking = await this.viking();
      if (viking) {
        try {
          const { stdout } = await run(viking.bin, ['find', query, '-u', vikingUri(this.botId), '-n', String(limit), '-o', 'json'], { timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
          return { passages: vikingPassages(stdout, limit), backend: 'openviking' };
        } catch {
          // Fall through to the local index.
        }
      }
    }
    let index = this.local();
    if (!index) {
      await this.reindex();
      index = this.local();
    }
    // Never a passage of a file that became a secret's name since.
    return { passages: index ? searchIndex(index, query, limit).filter((p) => !isSecretPath(this.at(p.file))) : [], backend: 'local' };
  }
}

/** HTML → its readable text: scripts and styles out, tags out, entities decoded, blank lines squeezed. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Passages as the knowledge_search tool answers. */
export function passagesText(found: { readonly passages: readonly Passage[]; readonly backend: KnowledgeBackend }, query: string): string {
  const where = found.backend === 'openviking' ? 'OpenViking' : 'the local full-text index';
  if (!found.passages.length) return `Nothing in your knowledge matches “${query}” (searched ${where}). Say so rather than guessing.`;
  return [`${found.passages.length} passage${found.passages.length === 1 ? '' : 's'} for “${query}” (searched ${where}). Quote the source you use.`, '', ...found.passages.map((p, i) => `[${i + 1}] ${p.source} (${p.file})\n${p.text}`)].join('\n\n');
}
