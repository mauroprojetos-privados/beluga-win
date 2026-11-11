#!/usr/bin/env node
// A stand-in for OpenViking's `ov` command line (docs/bots.md, Knowledge), for tests/bots-autonomy.test.ts:
// the commands Beluga runs (health, rm, add-resource, find -o json), kept in a JSON file in <store>.
// `node fake-ov.mjs <store> <command> …`. A file named `down` in <store> makes every command fail, as
// a server that stopped answering. Each call is appended to <store>/calls.log.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [store, cmd, ...args] = process.argv.slice(2);
mkdirSync(store, { recursive: true });
appendFileSync(path.join(store, 'calls.log'), `${[cmd, ...args].join(' ')}\n`);
if (existsSync(path.join(store, 'down'))) {
  process.stderr.write('Error: the OpenViking server isn’t answering\n');
  process.exit(1);
}
const file = path.join(store, 'index.json');
const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
const write = (items) => writeFileSync(file, JSON.stringify(items));
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

switch (cmd) {
  case 'health':
    process.stdout.write('ok\n');
    break;
  case 'rm': {
    const uri = args[0];
    write(read().filter((r) => !r.uri.startsWith(uri)));
    break;
  }
  case 'add-resource': {
    const from = args[0];
    const to = flag('-p');
    const items = read();
    const add = (abs, rel) => items.push({ uri: `${to}/${rel}`, content: readFileSync(abs, 'utf8') });
    const walk = (dir, rel) => {
      for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        const r = rel ? `${rel}/${name}` : name;
        if (statSync(abs).isDirectory()) walk(abs, r);
        else add(abs, r);
      }
    };
    if (statSync(from).isDirectory()) walk(from, '');
    else add(from, path.basename(from));
    write(items);
    break;
  }
  case 'find': {
    const query = args[0].toLowerCase();
    const under = flag('-u');
    const n = Number(flag('-n') ?? 5);
    const words = query.split(/\W+/).filter((w) => w.length > 1);
    const results = read()
      .filter((r) => r.uri.startsWith(under))
      .map((r) => ({ uri: r.uri, content: r.content.slice(0, 500), score: words.filter((w) => r.content.toLowerCase().includes(w)).length / Math.max(1, words.length) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
    process.stdout.write(JSON.stringify({ results }));
    break;
  }
  default:
    process.stderr.write(`unknown command ${cmd}\n`);
    process.exit(2);
}
