import fs, { mkdtempSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// GitHub's Windows runners name the temp folder the short 8.3 way (C:\Users\RUNNER~1\…), while git
// and Beluga see it by its long name: use the long one, so the folders the tests make match.
if (process.platform === 'win32') {
  process.env.TEMP = process.env.TMP = realpathSync.native(os.tmpdir());
  // A shell or git that just ended still holds its folder for a moment there: a test's cleanup
  // tries again rather than failing the test it follows.
  const rm = fs.rmSync;
  fs.rmSync = ((p, o) => rm(p, o?.recursive ? { maxRetries: 10, retryDelay: 100, ...o } : o)) as typeof fs.rmSync;
  syncBuiltinESMExports();
}

// Never read or write the developer's real ~/.beluga (or an old ~/.klaud) during tests.
process.env.BELUGA_HOME = mkdtempSync(path.join(os.tmpdir(), 'beluga-test-home-'));
// Nor the old name, for a test that clears BELUGA_HOME (an inherited KLAUD_HOME is real data).
delete process.env.KLAUD_HOME;
// Nor the developer's Codex sessions (deleting a worktree forgets the ones that ran there).
process.env.CODEX_HOME = mkdtempSync(path.join(os.tmpdir(), 'beluga-test-codex-'));

// The tests are a Mac's wherever they run ("Your Mac"; shared/assistant.ts).
process.env.BELUGA_COMPUTER ??= 'mac';

// The daemon's language is English in tests, whatever this computer speaks (src/core/language.ts).
process.env.BELUGA_LANGUAGE = 'en';

// Dates, numbers and money format as US English in tests, whatever this computer speaks: what
// formats with the system's language (no locale given) gets en-US, so a pt-BR or de-DE machine
// reads "$84.50" and "11/11/2026" as CI does. A locale a test names is kept (docs/i18n.md).
const TEST_LOCALE = 'en-US';
const pinned = (locales: unknown): unknown => (locales === undefined || (Array.isArray(locales) && locales.length === 0) ? TEST_LOCALE : locales);
for (const name of ['DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Collator', 'DisplayNames', 'Segmenter'] as const) {
  const Real = (Intl as unknown as Record<string, (new (l?: unknown, o?: unknown) => object) & { supportedLocalesOf: unknown }>)[name];
  if (!Real) continue;
  const Pinned = function (this: unknown, locales?: unknown, options?: unknown) {
    return new Real(pinned(locales), options);
  } as unknown as typeof Real;
  Object.setPrototypeOf(Pinned, Real);
  Pinned.prototype = Real.prototype;
  (Intl as unknown as Record<string, unknown>)[name] = Pinned;
}
for (const [proto, methods] of [
  [Date.prototype, ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']],
  [Number.prototype, ['toLocaleString']],
  [BigInt.prototype, ['toLocaleString']],
  [Array.prototype, ['toLocaleString']],
  [String.prototype, ['localeCompare']],
] as const) {
  for (const m of methods) {
    const real = (proto as unknown as Record<string, (...a: unknown[]) => unknown>)[m]!;
    Object.defineProperty(proto, m, {
      configurable: true,
      writable: true,
      value: m === 'localeCompare' ? function (this: string, that: string, locales?: unknown, options?: unknown) { return real.call(this, that, pinned(locales), options); } : function (this: unknown, locales?: unknown, options?: unknown) { return real.call(this, pinned(locales), options); },
    });
  }
}
