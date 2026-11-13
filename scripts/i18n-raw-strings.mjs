#!/usr/bin/env node
// Finds text written straight into .tsx screens instead of going through t() (docs/i18n.md):
// JSX text with letters, and string literals with letters in the props people read (label, title,
// placeholder, aria-label…). A line marked `// i18n-ignore` (or the line before it) is skipped,
// for what is never translated (a product name, a sample command).
//
//   node scripts/i18n-raw-strings.mjs <file or folder>…     lists each one, file:line  text
//   node scripts/i18n-raw-strings.mjs --count <folder>…     how many per file, most first
//
// tests/i18n-raw-strings.test.ts runs it over the screens already migrated.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TypeScript 7 has no JS API: Babel's parser reads TSX (installed with @vitest/coverage-v8, and in packages/companion).
import { parse } from '@babel/parser';

/** Props whose text a person reads or hears. */
export const READ_PROPS = new Set(['label', 'title', 'placeholder', 'aria-label', 'accessibilityLabel', 'accessibilityHint', 'alt', 'detail', 'hint', 'intro', 'submitLabel', 'sub', 'description', 'tooltip', 'caption', 'empty', 'emptyText', 'message', 'confirmLabel', 'cancelLabel', 'heading', 'subtitle']);

const LETTERS = /\p{L}{2,}/u;

/** Text a person reads: two letters in a row at least, and not an identifier-looking token (`main`, `ws-1`). */
function readable(text) {
  const s = text.trim();
  if (!LETTERS.test(s)) return false;
  // One lowercase word with no spaces is usually a key, an id, a mode or a CSS value, not words.
  if (/^[a-z][\w.:/#-]*$/.test(s)) return false;
  return true;
}

/** Every raw string in one .tsx file: `{ line, text }`. */
export function rawStrings(file) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
  const found = [];
  const add = (node, text) => {
    const line = node.loc.start.line;
    if (/i18n-ignore/.test(lines[line - 1] ?? '') || /i18n-ignore/.test(lines[line - 2] ?? '')) return;
    found.push({ line, text: text.trim().replace(/\s+/g, ' ').slice(0, 120) });
  };
  const literalText = (e) => {
    if (!e) return undefined;
    if (e.type === 'StringLiteral') return e.value;
    if (e.type === 'TemplateLiteral') return e.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' ');
    return undefined;
  };
  /** The strings an expression can be: both sides of a ?:, each side of ??, || and &&. */
  const branches = (e) => {
    if (!e) return [];
    if (e.type === 'ConditionalExpression') return [...branches(e.consequent), ...branches(e.alternate)];
    if (e.type === 'LogicalExpression') return [...branches(e.left), ...branches(e.right)];
    if (e.type === 'TSAsExpression' || e.type === 'TSSatisfiesExpression') return branches(e.expression);
    return [e];
  };
  const check = (exprs) => {
    for (const b of exprs) {
      const text = literalText(b);
      if (text !== undefined && readable(text)) add(b, text);
    }
  };
  const propName = (key) => (key?.type === 'Identifier' ? key.name : key?.type === 'StringLiteral' ? key.value : undefined);
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXText') {
      // Its line is where the words start, after the line breaks before them.
      const lead = node.value.slice(0, node.value.length - node.value.trimStart().length).split('\n').length - 1;
      if (readable(node.value)) add({ loc: { start: { line: node.loc.start.line + lead } } }, node.value);
    } else if (node.type === 'JSXExpressionContainer' && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) {
      // {'Some words'} or {cond ? 'Yes' : 'No'} between tags.
      check(branches(node.expression));
    } else if (node.type === 'JSXAttribute' && READ_PROPS.has(node.name.name) && node.value) {
      check(node.value.type === 'StringLiteral' ? [node.value] : node.value.type === 'JSXExpressionContainer' ? branches(node.value.expression) : []);
    } else if (node.type === 'ObjectProperty' && READ_PROPS.has(propName(node.key))) {
      // { label: 'Light' } in a list of options.
      check(branches(node.value));
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) visit(c, node);
      else if (child && typeof child === 'object') visit(child, node);
    }
  };
  visit(ast.program, undefined);
  return found;
}

function* tsxFiles(target) {
  if (statSync(target).isDirectory()) {
    for (const name of readdirSync(target)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      yield* tsxFiles(path.join(target, name));
    }
  } else if (target.endsWith('.tsx')) yield target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const count = args[0] === '--count';
  const targets = count ? args.slice(1) : args;
  if (!targets.length) {
    console.error('usage: node scripts/i18n-raw-strings.mjs [--count] <file or folder>…');
    process.exit(2);
  }
  const rows = [];
  for (const t of targets) for (const f of tsxFiles(t)) rows.push([f, rawStrings(f)]);
  if (count) {
    rows.sort((a, b) => b[1].length - a[1].length);
    for (const [f, found] of rows) if (found.length) console.log(`${String(found.length).padStart(5)}  ${f}`);
    console.log(`${rows.reduce((n, [, f]) => n + f.length, 0)} raw strings in ${rows.filter(([, f]) => f.length).length} files`);
  } else {
    for (const [f, found] of rows) for (const r of found) console.log(`${f}:${r.line}  ${r.text}`);
  }
}
