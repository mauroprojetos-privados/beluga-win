import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script, no types.
import { rawStrings } from '../scripts/i18n-raw-strings.mjs';

/**
 * Screens already moved to t() (docs/i18n.md): a new raw string in one of them fails here. Find a
 * file's raw strings with `node scripts/i18n-raw-strings.mjs <file>`; mark what is never translated
 * with `// i18n-ignore`.
 */
const MIGRATED: readonly string[] = [];

describe('migrated screens say every word through t()', () => {
  it('lists real files', () => {
    expect(MIGRATED.length).toBeGreaterThanOrEqual(0);
  });
  for (const file of MIGRATED) {
    it(file, () => {
      const found = (rawStrings(file) as { line: number; text: string }[]).map((r) => `${file}:${r.line}  ${r.text}`);
      expect(found).toEqual([]);
    });
  }
});

describe('the raw-string finder', () => {
  it('finds JSX text and read props, and skips what is no words or marked', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'beluga-i18n-')), 'X.tsx');
    writeFileSync(
      file,
      [
        'export const X = ({ on }: { on: boolean }) => (',
        '  <div title="Open the plan" className="row-main">',
        '    Hello there',
        "    {on ? 'Turn off' : t('x.on')}",
        '    <Button label={t(\'x.save\')} icon="check" />',
        "    {' · '} 42 {/* i18n-ignore */}",
        '    Beluga {/* i18n-ignore */}',
        '  </div>',
        ');',
        "const OPTIONS = [{ value: 'a', label: 'Light' }];",
      ].join('\n'),
    );
    expect((rawStrings(file) as { line: number; text: string }[]).map((r) => [r.line, r.text])).toEqual([
      [2, 'Open the plan'],
      [3, 'Hello there'],
      [4, 'Turn off'],
      [10, 'Light'],
    ]);
  });
});
