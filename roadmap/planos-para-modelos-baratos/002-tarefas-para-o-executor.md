# Plano 002: cada tarefa de plano diz como se prova, o que não tocar e quando parar

> **Instruções para quem executa**: siga o plano passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes de seguir. Se acontecer qualquer item de "Quando parar",
> pare e reporte; não improvise. No fim, atualize a linha deste plano em
> `roadmap/planos-para-modelos-baratos/README.md`.
>
> **Conferência de mudanças (rode primeiro)**:
> `git diff --stat bdb82aa2..HEAD -- src/core/plans/model.ts src/core/plans/edit.ts src/core/plans/plans.ts src/agent/plan-tools.ts src/core/plans/prompt.ts src/core/plans/coherence.ts src/companion/views.ts src/companion/protocol.ts src/shared/i18n/areas/phoneApp.ts "packages/companion/app/plan/[id].tsx"`
> Se algum desses arquivos mudou, compare os trechos de "Como está hoje" com o código atual; se não
> baterem, isso é um motivo para parar.

## Situação

- **Prioridade**: P1
- **Esforço**: M
- **Risco**: LOW (só campos opcionais novos e texto de prompt)
- **Depende de**: nenhum
- **Categoria**: direction
- **Escrito em**: commit `bdb82aa2`, 2026-11-13
- **Modelo sugerido**: Sonnet 5.5

## Por que importa

O agente que executa uma etapa de plano (o "agente do milestone") roda num modelo mais barato que o
que planejou. Hoje cada tarefa diz o objetivo, o contexto, os critérios e os arquivos, mas não diz
**como provar** cada critério, **o que não tocar** nem **quando parar**. Um modelo menor improvisa
exatamente onde um maior pararia. Este plano acrescenta quatro campos opcionais à tarefa, faz o
planejador preenchê-los, mostra-os ao agente do milestone e avisa o planejador quando faltam.

Os campos novos:

| Campo | Tipo | Limite | Para quê |
|---|---|---|---|
| `verify` | `{ run: string; expect: string }[]` | até 8; `run` até 400, `expect` até 200 caracteres | o comando que prova um critério e o que deve sair |
| `outOfScope` | `string[]` | até 10, 200 caracteres cada | arquivos ou áreas tentadores que não devem ser tocados |
| `stopIf` | `string[]` | até 6, 300 caracteres cada | "se isto acontecer, pare esta tarefa e diga por quê" |
| `exemplar` | `string` | 200 caracteres | um arquivo do repositório que já segue a convenção a copiar |

## Como está hoje

- `src/core/plans/model.ts:39` — `interface PlanTask` (o que fica salvo). Campos atuais: `id`,
  `title`, `goal?`, `context?`, `acceptance`, `blockedBy`, `parent?`, `priority?`, `estimate?`,
  `labels?`, `touches?`, `assignee?`, `decision?`, `issueId?`. Cada campo tem um comentário curto em
  inglês acima.
- `src/core/plans/edit.ts:20` — `interface TaskInput` (o que entra). `edit.ts:186` — `function task(input, id, keep)`
  monta a `PlanTask`, limpando e limitando cada campo. Exemplo do padrão a copiar:

  ```ts
  const touches = [...new Set((input.touches ?? []).map((t) => oneLine(t, 200)).filter(Boolean))].slice(0, MAX_TOUCHES);
  ...
  ...(touches.length ? { touches } : {}),
  ```

- `src/core/plans/edit.ts:328` — `case 'update_task'`: monta `merged` campo a campo
  (`...((p.touches ?? t.touches) ? { touches: (p.touches ?? t.touches)! } : {})`). **Campo que não
  entrar aqui some ao editar a tarefa.**
- `src/core/plans/plans.ts:76` — o zod do plano salvo; a tarefa já é `.passthrough()`, então
  campos novos sobrevivem ao reabrir o arquivo. Não precisa mudar.
- `src/agent/plan-tools.ts:21` — `const TASK = z.object({...})`, o esquema da ferramenta que o
  planejador chama (`plan_write`, `add_task`, `update_task`). Cada campo tem `.describe(...)` curto.
  `plan-tools.ts:89` — `taskInput(t)` converte a entrada da ferramenta (`snake_case`) em `TaskInput`
  (`camelCase`): `...(t.touches ? { touches: t.touches } : {})`.
- `src/core/plans/prompt.ts:64` — `const HOW_TO_PLAN = [ ... ].join('\n')`, as instruções de como
  cortar um plano. Uma das linhas atuais:
  `'- Every task has a goal in your own words, the context someone new needs, and acceptance criteria. Use'`.
- `src/core/plans/prompt.ts:509` — `function taskBlock(t, i, view, full)`: o texto de cada tarefa
  que o agente do milestone recebe. Hoje:

  ```ts
  ...(t.task.touches?.length ? [`   Files: ${t.task.touches.join(', ')}`] : []),
  ...(acceptance ? ['   Done means:', ...acceptance.split('\n').filter((l) => l.trim()).map((l) => `   ${l.trim()}`)] : []),
  ```

- `src/core/plans/prompt.ts` — `function milestoneHow(plan, only)`, a lista "How to work (fast)".
  Um dos itens: `'  run typecheck and only the tests you added or changed; commit (one commit per task, its message starting with the key);'`.
- `src/core/plans/coherence.ts:217` — `coherenceWarnings(body, previous)` junta listas de avisos
  (`staleDecisions`, `danglingRefs`, `duplicates`, `sharedTouches`, `emptyMilestones`). Cada uma é
  `(body) => string[]`. Nomes de tarefa saem de `const name = (t: PlanTask) => \`[${t.id}] “${t.title}”\`` (linha 69).
  Copie o formato de `emptyMilestones` (linha 147).
- O celular: `src/companion/protocol.ts:758` — `PlanTaskView` (zod). `src/companion/views.ts:982`
  monta cada tarefa do plano (`acceptance`, `blockedBy`, `why`, sempre com `clip(plainLine(...))`).
  `packages/companion/app/plan/[id].tsx:359` desenha os critérios com `◦` em `T v="caption"`.
  `COMPANION_PROTO` fica em `protocol.ts:12` (`{ major: 1, minor: 55 }`), e cada minor tem uma
  frase no comentário logo abaixo (a de 1.55 é a última, linha ~148).
- **Regra do repositório (CLAUDE.md):** fora da aba Files, nada de código vai para o celular. Os
  comandos de `verify` são código: **não vão para o celular**. Vão `stopIf` (texto) e o número de
  verificações.
- Testes que servem de modelo:
  - `tests/plan-milestone-agent.test.ts:127` ("its brief is lean…"): monta um plano com `running()`
    e confere o texto com `expect(p).toContain(...)`. O plano de teste é a constante `BODY` no
    começo do arquivo.
  - `tests/plan-coherence.test.ts`: usa `normalizeBody`, `applyOps` e `coherenceWarnings`.

## Comandos

| Para quê | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sai com 0 |
| Testes do plano | `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-coherence.test.ts tests/plans.test.ts` | todos passam |
| Testes do celular | `npx vitest run tests/companion-*` | todos passam |
| Tipos do celular | `cd packages/companion && npm run typecheck` | sai com 0 |

## Escopo

**Pode mudar:**
- `src/core/plans/model.ts`, `src/core/plans/edit.ts`
- `src/agent/plan-tools.ts`
- `src/core/plans/prompt.ts` (só `HOW_TO_PLAN`, `taskBlock`, `milestoneHow` e, se existir o mesmo
  bloco de tarefa, `workerNote`)
- `src/core/plans/coherence.ts`
- `src/companion/protocol.ts`, `src/companion/views.ts`
- `packages/companion/app/plan/[id].tsx`
- `src/shared/i18n/areas/phoneApp.ts` (duas chaves novas, nos dois blocos)
- `tests/plan-milestone-agent.test.ts`, `tests/plan-coherence.test.ts`, `tests/plans.test.ts` (só se o
  aviso novo mudar uma resposta que ele confere), um teste do celular
- `docs/tasks-and-plans.md`, `docs/companion.md` (se ele lista os minors)

**Não mexa:**
- `src/core/board/` e as seções do brief (`BRIEF_SECTIONS`): os campos novos ficam na tarefa do
  plano e no texto do agente, não no board. Mexer no brief obriga a mudar o Mac e o celular inteiros.
- `src/core/plans/apply.ts` (`briefOf`): mesma razão.
- `src/core/plans/plans.ts`: o zod já aceita campos novos.
- `src/core/plans/pilot.ts`: nada do andamento muda neste plano.

## Git

- Um commit por passo grande (passos 1–2, 3, 4, 5), estilo `feat(plans): <frase>`. Não faça push.

## Passos

### Passo 0: linha de base

**Verifique**: os quatro comandos da tabela → anote o que já falha antes de mexer.

### Passo 1: os campos no modelo e na edição

1. `model.ts`, em `PlanTask`, depois de `touches`: os quatro campos opcionais, cada um com um
   comentário de uma linha em inglês (por exemplo `/** How to prove it: a command and what it prints when it works. */`).
   Para `verify`, exporte `interface PlanVerify { readonly run: string; readonly expect: string }`.
2. `edit.ts`, em `TaskInput`: os mesmos quatro, opcionais.
3. `edit.ts`, em `task()`: limpe e limite como `touches` (sem repetidos, sem vazios, limites da tabela
   em "Por que importa"; use `oneLine`). Um `verify` sem `run` some. Só inclua o campo quando não
   estiver vazio.
4. `edit.ts`, em `case 'update_task'`: os quatro campos entram em `merged`, no mesmo formato de
   `touches`.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 2: a ferramenta do planejador

Em `plan-tools.ts`, no `TASK`, depois de `touches`:

- `verify: z.array(z.object({ run: z.string().min(1).max(400), expect: z.string().min(1).max(200) })).max(8).optional().describe('How to prove each acceptance criterion: the exact command and what it prints when it works')`
- `out_of_scope: z.array(z.string().min(1).max(200)).max(10).optional().describe('Files or areas that look related but must not be changed')`
- `stop_if: z.array(z.string().min(1).max(300)).max(6).optional().describe('When to stop this task and say why instead of improvising: what you could not confirm by reading the code')`
- `exemplar: z.string().max(200).optional().describe('A file in this repository that already follows the pattern to copy')`

E em `taskInput`: `out_of_scope → outOfScope`, `stop_if → stopIf`, os outros iguais.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 3: o planejador é instruído, e o agente do milestone lê

1. `HOW_TO_PLAN`: logo **antes** do item `'- Use short, stable ids (like "auth-api"): keep them when you revise, so tasks keep their history.',`
   (assim o bloco não cai no meio do item "Every task has a goal…", que ocupa cinco linhas),
   acrescente este bloco, em inglês como o resto:

   ```
   '- Write each task for a smaller model that has never seen this conversation. Put in its context what it needs',
   '  (exact paths, how the code is today in a few lines). For a task of 2 points or more, also give: `verify`, one',
   '  command per acceptance criterion and what it prints when it works; `out_of_scope`, what is tempting to change',
   '  but must not be; `stop_if`, what you could not confirm by reading the code (at most 6); and an `exemplar` file.',
   ```

2. `taskBlock`, quando `full` é verdadeiro, depois de "Done means":
   - `   Prove it:` e uma linha por `verify`: `` `   - ${v.run} → ${v.expect}` ``
   - `   Don't touch: ${outOfScope.join(', ')}`
   - `   Stop and say why if:` e uma linha por `stopIf`: `   - ${s}`
   - `   Follow the pattern in: ${exemplar}`
3. `milestoneHow`: no item que começa com `'  run typecheck and only the tests…'`, antes dele, um item
   novo: `'  run each of its "Prove it" commands and check what it prints before you tick that criterion;'`.
   E um item novo, logo depois do item de "A task only the user can decide" (ele ocupa **duas**
   linhas do array: a que começa com `'- A task only the user can decide:` e a que começa com
   `'  need it, and end your turn…'`; o item novo vai depois da segunda):
   `'- If one of a task\'s "Stop and say why if" happens, stop that task: say what you saw in one line with task_note on it, leave it as it is, and go on with the tasks that don\'t build on it.'`
4. `workerNote` (mesmo arquivo, linha ~482) é o texto do modo antigo "uma worktree por tarefa". Ele
   já tem a linha `` me.task.touches?.length ? `This task's area: ${me.task.touches.join(', ')}.` : '' ``.
   Logo depois dela, mostre os mesmos quatro campos, no mesmo formato do item 2 (sem o recuo de três
   espaços). Extraia uma função pequena `guardLines(task: PlanTask, indent: string): string[]` e use
   nos dois lugares, para não repetir.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 4: avisos de coerência

Em `coherence.ts`, crie `function weakTasks(body: PlanBody): string[]` e inclua-a em
`coherenceWarnings`, depois de `sharedTouches`:

- tarefa com `estimate` ≥ 2, `assignee` diferente de `'me'` e sem `verify`:
  `` `${name(t)} has no verify: give a command for each acceptance criterion and what it prints when it works.` ``
- tarefa cujo `touches` tem um caminho que está no `outOfScope` de outra tarefa **do mesmo
  milestone**: `` `${name(a)} touches ${path}, which ${name(b)} says not to touch: fix one of them.` ``
  (compare caminhos com a mesma função que `sharedTouches` usa, `sharedPaths`).

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 5: testes

1. `tests/plan-milestone-agent.test.ts`: dê a uma tarefa do `BODY` um `verify`, um `outOfScope`, um
   `stopIf` e um `exemplar` (no formato `TaskInput`: `outOfScope`, `stopIf`). Num teste novo, modelado
   no da linha 127, confira que o texto do agente contém `Prove it:`, o `run → expect`,
   `Don't touch:`, `Stop and say why if:` e `Follow the pattern in:`. Confira também que o teste da
   linha 127 continua passando sem mudanças.
2. `tests/plan-coherence.test.ts`: (a) tarefa de 3 pontos sem `verify` gera o aviso; com `verify`,
   não; tarefa de 1 ponto, não; tarefa `assignee: 'me'`, não. (b) duas tarefas do mesmo milestone,
   uma com `touches: ['src/a.ts']` e a outra com `outOfScope: ['src/a.ts']`, geram o aviso.
   (c) `applyOps` com `update_task` mudando só o título mantém os quatro campos.
3. A conversão da ferramenta: importe `taskInput` de `../src/agent/plan-tools.js` e confira que
   `taskInput({ title: 'x', stop_if: ['a'], out_of_scope: ['b'], verify: [{ run: 'npm test', expect: 'pass' }], exemplar: 'src/x.ts' })`
   devolve `stopIf`, `outOfScope`, `verify` e `exemplar`. (Não use `tools!.write` para isto: ele já
   recebe o formato `camelCase` e não passa por `taskInput`.)
4. `tests/plans.test.ts` tem tarefas de 3 e 5 pontos sem `verify` (linhas ~155–156): o aviso novo
   passa a aparecer nas respostas de `write` ali. Se um teste desse arquivo conferir a resposta
   inteira e falhar por isso, ajuste só a expectativa (o aviso é o comportamento novo), nunca o
   aviso.

**Verifique**: `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-coherence.test.ts tests/plans.test.ts` →
todos passam, com os novos.

### Passo 6: o celular

1. `protocol.ts`, em `PlanTaskView`: `stopIf: z.array(z.string().max(300)).max(6).optional()` e
   `checks: z.number().int().min(0).max(8).optional()` (quantas verificações), com um comentário
   `/** 1.56: … */`. Suba `COMPANION_PROTO.minor` para 56 e acrescente a frase de 1.56 no comentário
   de versões ("a plan task's stop conditions and how many checks prove it (`PlanTaskView.stopIf`,
   `checks`); an older phone ignores them").
2. `views.ts:982`: `...(t.task.stopIf?.length ? { stopIf: t.task.stopIf.slice(0, 6).map((s) => clip(plainLine(s, 300), 300)) } : {})`
   e `...(t.task.verify?.length ? { checks: t.task.verify.length } : {})`. **Não envie `verify`.**
3. Os textos: em `src/shared/i18n/areas/phoneApp.ts`, ao lado de `'phoneApp.plan.yourAgentIs'` nos
   dois blocos (inglês na linha ~231, português na ~822), acrescente
   `'phoneApp.plan.provedBy': 'Proved by {count} checks'` / `'phoneApp.plan.provedBy': 'Provada por {count} verificações'`
   e `'phoneApp.plan.stopsIf': 'Stops if'` / `'phoneApp.plan.stopsIf': 'Para se'`.
4. `plan/[id].tsx`, logo depois do bloco de `acceptance` (linha ~359), com o mesmo estilo. **Atenção:**
   dentro desse `map`, `t` é a tarefa (ela esconde o `t` importado na linha 22); os textos da tela
   saem de `say(...)` (`const say = useT();`, como em `say('phoneApp.plan.yourAgentIs', …)`):
   - quando `shown && t.checks`: `<T v="caption" c={color.text3} style={{ marginTop: 4 }}>{say('phoneApp.plan.provedBy', { count: t.checks })}</T>`;
   - quando `shown && t.stopIf?.length`: `say('phoneApp.plan.stopsIf')` numa linha e, abaixo, a lista
     com `◦`, igual à de `acceptance`.
5. Um teste em `tests/` (procure o que já testa `planPageView`: `grep -rln planPageView tests`):
   a tarefa com `verify` e `stopIf` sai com `checks` e `stopIf`, e **o texto do comando de `verify`
   não aparece** em `JSON.stringify(view)`.

**Verifique**: `npx vitest run tests/companion-*` → todos passam;
`cd packages/companion && npm run typecheck` → sai com 0.

### Passo 7: documentação

`docs/tasks-and-plans.md`, em "The model": uma frase sobre os quatro campos e para que servem, e
uma frase em "Planning with the agent" sobre o aviso novo. Se `docs/companion.md` lista os minors,
a linha de 1.56.

**Verifique**: `git diff --stat` mostra só arquivos do escopo.

## Pronto quando

- [ ] `npm run typecheck` sai com 0
- [ ] `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-coherence.test.ts tests/plans.test.ts tests/companion-*` passa
- [ ] `cd packages/companion && npm run typecheck` sai com 0
- [ ] `grep -n "task.verify" src/companion/views.ts` mostra só a linha da contagem (`checks: t.task.verify.length`), nunca o texto do comando
- [ ] `grep -n "minor: 56" src/companion/protocol.ts` acha uma linha
- [ ] `git status` mostra só arquivos do escopo
- [ ] A linha deste plano no `README.md` desta pasta está atualizada

## Quando parar

- `PlanTask`, `TaskInput`, `task()`, `update_task`, `TASK` ou `taskBlock` não estão como em "Como
  está hoje".
- O plano salvo perde os campos novos ao reabrir (o zod de `plans.ts:76` não é mais `passthrough`):
  não mude o zod sem reportar antes.
- O celular desenha a tarefa em outro arquivo que não `app/plan/[id].tsx`.
- Parece necessário mexer no board, no brief ou no `pilot.ts`.
- Um teste do passo 0 que passava falha duas vezes seguidas depois de uma tentativa de correção.

## Notas para quem mantém

- O plano 005 usa `stopIf` para o agente parar uma tarefa com motivo; até lá, a parada é só uma nota
  (`task_note`) e o agente segue com as outras.
- Se um dia os campos forem para o brief do board, o Mac e o celular precisam de uma seção nova; isso
  ficou de fora de propósito.
- Na revisão, confira que `update_task` mantém os campos (é o erro mais fácil de cometer aqui).
