# Plano 001: "Opus planeja, Sonnet constrói" vale em toda máquina com o Claude

> **Instruções para quem executa**: siga o plano passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes de seguir. Se acontecer qualquer item de "Quando parar",
> pare e reporte; não improvise. No fim, atualize a linha deste plano em
> `roadmap/planos-para-modelos-baratos/README.md`.
>
> **Conferência de mudanças (rode primeiro)**:
> `git diff --stat bdb82aa2..HEAD -- src/core/stack/launch.ts src/daemon/core.ts tests/stack.test.ts`
> Se algum desses arquivos mudou, compare os trechos de "Como está hoje" com o código atual; se não
> baterem, isso é um motivo para parar.

## Situação

- **Prioridade**: P1
- **Esforço**: S
- **Risco**: LOW
- **Depende de**: nenhum
- **Categoria**: direction
- **Escrito em**: commit `bdb82aa2`, 2026-11-13
- **Modelo sugerido**: Sonnet 5.5

## Por que importa

O Beluga já tem um preset em que o agente que planeja (Plan head) roda no Opus, e as etapas, o
verificador e o revisor rodam no Sonnet. Hoje ele só é ligado dentro de `launchStack`, que o daemon
chama apenas com a rede ligada e fora do demo. Pior: ele é ligado mesmo quando o Claude **não** está
instalado, e aí os papéis apontam para combos só de Claude que nunca rodam (o plano mostra "Nothing
in Claude: Opus first can run"). Depois deste plano, o preset é ligado uma vez em toda máquina que
tem o Claude disponível, com ou sem rede, e nunca em uma máquina sem o Claude.

## Como está hoje

- `src/core/stack/launch.ts`: o lançamento do stack e a função que liga o preset.
  - `claudeByKindOnce` (linhas 33–44):

    ```ts
    export function claudeByKindOnce(session: Pick<Session, 'setPrefs'>, store: Store, file = path.join(belugaHome(), 'stack.json')): boolean {
      const record = readRecord(file);
      if (record.claudeByKind) return false;
      const { prefs } = store.getState();
      if (prefs.categoryCombos === undefined && prefs.roleCombos === undefined) session.setPrefs(claudeByKind(prefs.combos));
      try {
        writeFileSync(file, `${JSON.stringify({ ...record, claudeByKind: Date.now() }, null, 2)}\n`, { mode: 0o600 });
      } catch {
        // Not written: asked again next start, still only while you have none.
      }
      return true;
    }
    ```

  - Dentro de `launchStack` (linha 61): `claudeByKindOnce(session, store);`
- `src/daemon/core.ts`:
  - linha 399: `let stopStack = (): void => undefined;`
  - linha 461: `if (opts.network && !demo) stopStack = launchStack({ session, store });`
  - linha 509: `stopStack();` (no fechamento)
  - linha 268: `const demo = config.mode === 'demo' ? createDemoFolders() : undefined;`
- Como o Beluga sabe se o Claude está instalado: `store.getState().runtimes` é uma lista de
  `RuntimeChoice` (`src/shared/agent-runtimes.ts:21`), com `id` (`'claude'`, `'codex'`…),
  `available: boolean` e `state?: 'ready' | 'signed_out' | 'missing' | 'no_endpoint'`.
  **Cuidado: `available` sozinho não basta.** O estado inicial (`src/core/work-store.ts:251`) já põe o
  Claude como `available: true`, sem `state`: é só um marcador de "há um backend", não "o Claude Code
  está instalado". A resposta de verdade chega depois, por `withRuntimeStatus`
  (`src/core/workbench.ts:134`), que grava `state: 'ready'` (instalado e com login) ou
  `state: 'missing' | 'signed_out'` com `available: false`. Só `state === 'ready'` quer dizer que o
  Claude roda nesta máquina.
- O store tem `subscribe(listener): () => void` (`src/core/store.ts:1556`).
- O teste atual: `tests/stack.test.ts:221`, "is set once, only when you never chose combos for kinds
  of work or roles". Use-o como modelo; ele monta `new Store(initialState('room'))`, uma sessão falsa
  `{ setPrefs }` e um `stack.json` num diretório temporário.
- Convenção: comentários curtos, em inglês, dizendo o porquê (veja os de `launch.ts`).

## Comandos

| Para quê | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sai com 0, sem erros |
| Teste deste plano | `npx vitest run tests/stack.test.ts` | todos passam |
| Tipos do celular | `cd packages/companion && npm run typecheck` | sai com 0 |

## Escopo

**Pode mudar:**
- `src/core/stack/launch.ts`
- `src/daemon/core.ts`
- `tests/stack.test.ts`
- `docs/stack.md` e `docs/routing.md` (uma frase cada, passo 4)

**Não mexa:**
- `src/core/routing/presets.ts`: o conteúdo do preset está certo.
- `packages/mac/src/dialogs/CombosSettings.tsx`: o botão "Claude by kind of work" já existe e chama
  `routing.useClaudeByKind`.
- Qualquer coisa que mude combos já salvos por alguém.

## Git

- Um commit no fim, no branch atual. Estilo do repositório: `fix(routing): <frase>`. Exemplo do log:
  `fix(wsl): read the kernel too, so the engine kept running as a service translates paths`.
- Não faça push.

## Passos

### Passo 0: linha de base

**Verifique**: `npx vitest run tests/stack.test.ts` → todos passam. Se algum já falha antes de você
mexer, anote quais (é a linha de base) e siga.

### Passo 1: esperar o Claude aparecer antes de decidir

Em `src/core/stack/launch.ts`, crie e exporte `watchClaudeByKind(session, store, file?)`, que
devolve uma função para parar de observar:

1. Se o `stack.json` já tem `claudeByKind`, não faz nada e devolve uma função vazia.
2. Senão, olha `store.getState().runtimes` agora e a cada mudança (`store.subscribe`):
   - nenhuma entrada com `id === 'claude'`, ou a do Claude **sem `state`** (o marcador inicial):
     espera;
   - a do Claude com `state` diferente de `'ready'` (`'missing'`, `'signed_out'`): espera (não grava
     nada; ele pode ser instalado ou receber login depois);
   - a do Claude com `state === 'ready'`: **primeiro** para de observar (chame a função que
     `subscribe` devolveu e marque uma variável `done = true`, que o listener confere logo no
     começo), **depois** chama `claudeByKindOnce(session, store, file)`. A ordem importa: o
     `setPrefs` de verdade despacha no store, o que chama os listeners de novo antes de o arquivo
     ser gravado.
3. Mantenha `claudeByKindOnce` como está: ela continua sendo a regra "uma vez, só se você não
   escolheu nada".

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 2: tirar do stack e ligar no daemon

- Em `launchStack`, apague a linha `claudeByKindOnce(session, store);`.
- Em `src/daemon/core.ts`, importe `watchClaudeByKind` no mesmo `import` que já traz `launchStack`
  (procure `from '../core/stack/launch.js'`). Ao lado de `let stopStack`, declare `let stopClaudeByKind = (): void => undefined;`.
  Logo depois da linha 461, fora de qualquer `if (opts.network …)`:
  `if (!demo) stopClaudeByKind = watchClaudeByKind(session, store);`
  No fechamento, ao lado de `stopStack();`, chame `stopClaudeByKind();`.

**Verifique**: `npm run typecheck` → sai com 0, e
`grep -n "claudeByKindOnce(session, store)" src/core/stack/launch.ts` → nenhuma linha.

### Passo 3: testes

Em `tests/stack.test.ts`, no mesmo `describe` do teste da linha 221, acrescente:

1. Com o estado inicial do store (o Claude como marcador, sem `state`), e depois com uma lista só com
   o Codex: `watchClaudeByKind` não chama `setPrefs` e não cria o `stack.json`.
2. O Claude aparece depois pronto (despache
   `{ type: 'runtimes', runtimes: [{ id: 'claude', label: 'Claude', available: true, state: 'ready' }] }`):
   `setPrefs` é chamado uma vez, o arquivo ganha `claudeByKind`, e uma segunda mudança de
   `runtimes` não chama de novo. Neste teste, faça o `setPrefs` falso despachar algo no store
   (por exemplo `store.dispatch({ type: 'prefs', prefs: p })`, como o teste da linha 232 faz), para
   provar que o listener não entra duas vezes.
3. O Claude com `available: false, state: 'missing'` (e, num segundo caso, `'signed_out'`): nada é
   chamado nem gravado.
4. Com `roleCombos` já salvo e o Claude com `state: 'ready'`: `setPrefs` não é chamado (a regra antiga).

**Verifique**: `npx vitest run tests/stack.test.ts` → todos passam, com os 4 novos.

### Passo 4: documentação

- `docs/stack.md`, linha 46 ("It's set **once by itself** when the daemon starts…"): diga que ele é
  ligado uma vez, assim que o Claude aparece disponível nesta máquina, com ou sem rede, e nunca no
  demo nem numa máquina sem o Claude.
- `docs/routing.md`, seção "By role (Phase 4)": uma frase dizendo que, até você escolher, os papéis
  já vêm com o Plan head no Opus e o resto no Sonnet, quando o Claude está instalado.

**Verifique**: `git diff --stat` mostra só arquivos da lista "Pode mudar".

## Pronto quando

- [ ] `npm run typecheck` sai com 0
- [ ] `npx vitest run tests/stack.test.ts` passa, com 4 testes novos
- [ ] `cd packages/companion && npm run typecheck` sai com 0
- [ ] `grep -n "watchClaudeByKind" src/daemon/core.ts` mostra a chamada fora de `opts.network`
- [ ] `git status` mostra só arquivos do escopo
- [ ] A linha deste plano no `README.md` desta pasta está atualizada

## Quando parar

- `claudeByKindOnce` ou as linhas citadas de `core.ts` não estão como em "Como está hoje".
- A entrada do Claude em `runtimes` não se chama `'claude'` (procure com
  `grep -rn "id: 'claude'" src/shared src/agent/runtime | head`). Não adivinhe outro nome.
- Algum teste que passava no passo 0 passa a falhar duas vezes seguidas depois de uma tentativa de
  correção.
- Parece necessário mexer em `presets.ts` ou na tela do Mac.

## Notas para quem mantém

- Quem desinstala o Claude depois de o preset ligar continua com combos só de Claude; isso é a regra
  antiga ("limpar depois é escolha sua") e fica fora deste plano.
- Na revisão, confira que nenhum caminho grava o `stack.json` quando o Claude não está disponível:
  é isso que deixa tentar de novo depois.
