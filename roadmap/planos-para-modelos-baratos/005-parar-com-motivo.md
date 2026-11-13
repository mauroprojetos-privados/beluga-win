# Plano 005: o agente da etapa pode parar uma tarefa com motivo, e o planejador a reescreve

> **Instruções para quem executa**: siga o plano passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes de seguir. Se acontecer qualquer item de "Quando parar",
> pare e reporte; não improvise. No fim, atualize a linha deste plano em
> `roadmap/planos-para-modelos-baratos/README.md`.
>
> **Conferência de mudanças (rode primeiro)**:
> `git diff --stat bdb82aa2..HEAD -- src/agent/board-tools.ts src/agent/policy.ts src/core/board/work.ts src/core/plans/model.ts src/core/plans/plans.ts src/core/plans/progress.ts src/core/plans/pilot.ts src/core/plans/prompt.ts src/core/plans/work.ts`
> Se algum desses arquivos mudou, compare os trechos de "Como está hoje" com o código atual; se não
> baterem, isso é um motivo para parar. **Este plano depende do 002**: confira que
> `grep -n "stopIf" src/core/plans/model.ts` acha o campo antes de começar.

## Situação

- **Prioridade**: P2
- **Esforço**: L
- **Risco**: HIGH (mexe em quais tarefas o pilot entrega ao agente da etapa)
- **Depende de**: 002 (o campo `stopIf` e a linha "Stop and say why if" no texto do agente)
- **Categoria**: direction
- **Escrito em**: commit `bdb82aa2`, 2026-11-13
- **Modelo sugerido**: Sonnet 5.5 com esforço `high`; se reprovar duas vezes na revisão, Opus 5.5

## Por que importa

Com o plano 002, cada tarefa diz quando parar (`stopIf`), mas parar é só uma nota: a tarefa fica
como estava, o pilot a entrega de novo ao agente da etapa, e ninguém reescreve o que estava errado.
Depois deste plano, o agente da etapa chama `task_stop` com o motivo; a tarefa sai da fila daquela
etapa; o agente principal do plano (o planejador, no Opus) recebe o motivo e reescreve, divide ou
passa a tarefa para você; e ela volta à fila quando é reescrita ou iniciada de novo. O agente da
etapa também passa a terminar o turno com um relatório fixo, que o verificador e o planejador leem.

## Como está hoje

- `src/agent/board-tools.ts` — as ferramentas de tarefa que todo agente tem. A lista de nomes
  (linha 13):
  `export const BOARD_TOOL_NAMES = ['task_define', 'task_get', 'task_list', 'task_create', 'board_create', 'task_update', 'task_brief_edit', 'task_note', 'task_relate', 'task_attach_proof'].map((n) => \`mcp__beluga_board__${n}\`);`
  O modelo a copiar é `task_note` (linha 150):
  `tool('task_note', 'Leave a note on a task’s activity: what you did, found or tried. Short.', { key, text: z.string().min(1).max(8000) }, (a) => guarded(() => board.note(a.key, a.text))),`
  `key` (linha 15) já cai na tarefa da worktree quando falta.
- `src/agent/policy.ts:42` repete a mesma lista de nomes (as ferramentas permitidas). As duas
  listas precisam do nome novo.
- `src/agent/mock.ts:1044` — o agente falso dos testes e do demo usa `task_note`; não precisa usar a
  ferramenta nova.
- O objeto `board` dessas ferramentas é o `RunBoard` que `BoardWork.forRun(channel, from, opts)`
  devolve (`src/core/board/work.ts:535`). Ele tem `note(key, text)`, `editBrief(...)` etc.
- **Não use uma ação nova no store para isto.** `Store.dispatch` (`src/core/store.ts:1540`) só avisa
  os ouvintes quando o estado muda (`if (next === this.state) return;`), e uma ação que o reducer não
  conhece não muda nada: o pilot nunca a veria. Use um callback, passo 2.
- `BoardWork` é criado com um objeto de dependências (veja `new BoardWork({ store, board, controller, selfId, selfName, askClaude })`
  em `tests/plan-milestone-agent.test.ts:68`), e `PlansWork` recebe esse `BoardWork` como `board`
  (mesmo arquivo, linha ~72).
- A escada de resgate decide se uma etapa está parada por `stallOf(view, m)` (`pilot.ts:154`). A
  última linha conta só as tarefas de `agentTasks`:

  ```ts
  const todo = agentTasks(m).filter((t) => !FINISHED.has(t.state));
  return todo.some((t) => t.state === 'ready' || t.state === 'idle' || t.state === 'running') ? 'working' : undefined;
  ```

  Para `'working'`, o resgate primeiro tenta mandar o agente seguir (`kick`), depois pede ao agente
  principal que decida (`head()`), e por fim passa para você (`pilot.ts:694–699`).
- Quais tarefas vão para o agente da etapa: `agentTasks(m)` em `src/core/plans/progress.ts:428`:

  ```ts
  export function agentTasks(m: Pick<MilestoneView, 'milestone' | 'tasks'>): readonly TaskView[] {
    return taskOrder(m).filter((t) => !t.forYou && t.issue && t.state !== 'canceled' && t.state !== 'missing');
  }
  ```

  `MilestoneView` tem `run: MilestoneRun`. `launch` (`pilot.ts:860`) e quem manda o agente seguir
  (procure `milestoneNextPrompt(` em `pilot.ts`) usam `agentTasks`.
- `MilestoneRun` em `src/core/plans/model.ts` (linha ~151); `withRun` em `plans.ts:561` mescla um
  patch nele. Um registro parecido já existe para tarefas que travam: `TaskWatch` (`model.ts:264`),
  com `at`, `reason`, `line`.
- Edição de tarefa pelo planejador: o `update_task` só muda o **rascunho** (`plans.editDraft`,
  `plans.ts:175`). A mudança vale quando o rascunho é aprovado: `plans.approved(id, body, by, summary)`
  (`plans.ts:228`), que em Autopilot é chamado na hora (`work.ts:619–621`) e nos outros modos quando
  você aprova. Iniciar de novo: a ferramenta `plan_start_task` (`src/agent/plan-tools.ts:181`) chama
  `plan.start(task)`, implementado em `src/core/plans/work.ts` (procure `start:` em `toolsFor`).
- O texto do agente da etapa: `milestoneHow` em `src/core/plans/prompt.ts` (depois do 002, ele tem o
  item "If one of a task's "Stop and say why if" happens, stop that task: … task_note …").
- Testes de modelo: `tests/plan-milestone-agent.test.ts`, em especial o da linha 229 ("fix tasks
  added after a failed check go to the same Claude…"): ele usa `running({ autonomy: 'autopilot' })`,
  `t.tools('safe')` (as ferramentas de tarefa do agente da etapa), `t.run(w, 'started' | 'done', id)`
  para simular o turno e `t.toAgent('safe')` / `t.asked` para ler o que foi mandado.

## O que precisa acontecer

1. O agente da etapa chama `task_stop { key?, reason }`.
2. A tarefa ganha uma nota "Stopped: <reason>" (pelo `note` que já existe) e um registro
   `runs[milestone].stopped[planTaskId] = { at, reason }` no plano.
3. `agentTasks` deixa essa tarefa de fora; o pilot não a entrega nem manda o agente "seguir" por
   causa dela. O agente segue com as outras.
4. O agente principal recebe, uma vez por parada, `stoppedPrompt(key, title, reason, stopIf)`:
   "reescreva a tarefa com `update_task` (contexto, `verify`, `stop_if`), divida, ou passe para o
   usuário (`assignee: "me"`) se for uma decisão; depois, `plan_start_task` se ela deve recomeçar".
   Em Autopilot, sem perguntar ao usuário; em Check-ins e Step by Step, propondo.
5. O registro sai (e a tarefa volta à fila) quando uma mudança nela é **aprovada** (não quando ela só
   muda no rascunho), quando ela é iniciada de novo, ou quando é removida do plano.
6. Uma etapa cuja única coisa restante é uma tarefa parada entra na escada de resgate como
   `'working'`: o agente principal é chamado a decidir e, se nada mudar, ela chega a você como hoje.
7. Ao fim do turno, o agente da etapa escreve o relatório:

   ```
   STATUS: COMPLETE | STOPPED
   TASKS: per task, done or stopped, and what each "Prove it" command printed
   STOPPED BECAUSE: (only if stopped) which "Stop and say why if", and what you saw
   NOTES: deviations, surprises, judgment calls
   ```

   "Report only what a tool result in this run shows; if a check failed or was skipped, say so."

## Comandos

| Para quê | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sai com 0 |
| Testes | `npx vitest run tests/plan-milestone-agent.test.ts tests/plans.test.ts tests/board*.test.ts tests/companion-*` | todos passam |
| Tipos do celular | `cd packages/companion && npm run typecheck` | sai com 0 |

## Escopo

**Pode mudar:**
- `src/agent/board-tools.ts`, `src/agent/policy.ts`
- `src/core/board/work.ts` (o `RunBoard`, para expor `stop`, e um callback opcional nas dependências
  do `BoardWork`)
- `src/core/plans/model.ts`, `src/core/plans/plans.ts`, `src/core/plans/progress.ts` (só `agentTasks`)
- `src/core/plans/work.ts` (ligar o callback, e limpar a parada no `start`)
- `src/core/plans/pilot.ts` (só o tratamento da parada, o envio do `stoppedPrompt` e uma linha em `stallOf`)
- `src/core/plans/prompt.ts` (`stoppedPrompt` e `milestoneHow`)
- `tests/plan-milestone-agent.test.ts`, `tests/board-work.test.ts` (só se a lista de ferramentas mudar a expectativa)
- `docs/tasks-and-plans.md`, `docs/parity.md` se ele lista as ferramentas dos agentes

**Não mexa:**
- `ISSUE_STATUSES` e o board em si: não crie um status novo de tarefa.
- O watchdog (`watchdog.ts`) e `rescue`.
- O celular: a parada aparece como nota da tarefa, que o celular já mostra. Nenhum card novo: quem
  resolve primeiro é o planejador, não você; se ele não resolver, a escada de resgate (com a linha
  nova em `stallOf`, passo 3) leva o caso até você pelo card de resgate que já existe.
- `src/core/store.ts` e as ações do store.

## Git

- Um commit por passo grande (1–2, 3–4, 5, 6), estilo `feat(plans): <frase>`. Não faça push.

## Passos

### Passo 0: linha de base

**Verifique**: os comandos da tabela → anote o que já falha. Confira o 002:
`grep -n "Stop and say why if" src/core/plans/prompt.ts` acha uma linha. Se não achar, pare.

### Passo 1: o registro no plano

1. `model.ts`, em `MilestoneRun`:
   `/** Tasks its agent stopped, with why (plan task id): left out of its queue until the plan's agent rewrites or restarts them. */ readonly stopped?: Readonly<Record<string, { readonly at: number; readonly reason: string; readonly told?: boolean }>>;`
2. `plans.ts`: `stopTask(id, milestone, taskId, reason)` grava com `withRun` e um evento
   `note` ("KEY stopped: reason", curto); `clearStopped(id, taskId)` tira o registro de qualquer
   etapa onde ele esteja (sem evento se não havia nada); `markStopTold(id, milestone, taskId)` grava
   `told: true`.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 2: a ferramenta

1. Em `board-tools.ts`, ao lado de `task_note`:
   `tool('task_stop', 'Stop a task of yours that you can’t do as written: one of its "Stop and say why if" happened, or its context is wrong. Say why in one or two lines. Then go on with the tasks that don’t build on it.', { key, reason: z.string().min(1).max(1000) }, (a) => guarded(() => board.stop(a.key, a.reason)))`
   e o nome `'task_stop'` nas duas listas (`BOARD_TOOL_NAMES` e `policy.ts:42`), **logo depois de
   `'task_note'`** nas duas, e a ferramenta logo depois de `task_note` na lista de definições:
   `tests/board-work.test.ts:371` confere que as definições saem na mesma ordem de `BOARD_TOOL_NAMES`.
2. Nas dependências do `BoardWork` (`board/work.ts`), um callback opcional
   `onTaskStopped?: (issueId: string, reason: string) => void`.
3. Em `RunBoard`, `stop(key, reason)`: deixa a nota "Stopped: reason" pelo mesmo caminho de `note` e
   chama `deps.onTaskStopped?.(issueId, reason)`. Resposta:
   `'Stopped. The plan’s agent rewrites it; go on with your other tasks.'`
4. Ligue o callback onde o `BoardWork` é criado junto do `PlansWork` (procure `new BoardWork(` em
   `src/`, fora de `tests/`) para chamar um método novo de `PlansWork`, `taskStopped(issueId, reason)`,
   que repassa ao pilot. Se o `BoardWork` é criado antes do `PlansWork` e não dá para passar o
   callback no construtor, aceite um `setOnTaskStopped(fn)` no `BoardWork`. Para uma tarefa que não é
   de plano, `taskStopped` não faz nada.

**Verifique**: `npm run typecheck` → sai com 0; `npx vitest run tests/board*.test.ts` → todos passam.

### Passo 3: o pilot tira da fila e avisa o planejador

1. `progress.ts`, `agentTasks`: passe a aceitar `Pick<MilestoneView, 'milestone' | 'tasks' | 'run'>` e
   deixe de fora `t` quando `m.run.stopped?.[t.task.id]`. Corrija os chamadores que o typecheck
   apontar (eles já têm a `MilestoneView` inteira).
2. `pilot.ts`, um método público `taskStopped(issueId, reason)` (o que o `PlansWork.taskStopped`
   chama): ache o plano, a etapa e a tarefa pelo `issueId` (a `TaskView` tem `issue.id`), chame
   `plans.stopTask(...)` e depois mande ao `plan.home`, uma vez (use `told`), `stoppedPrompt(...)`,
   com `this.deps.askClaude(texto, plan.home, false)` como `checkFailedPrompt` faz.
3. `prompt.ts`, `stoppedPrompt(key, title, reason, stopIf, autopilot)`, em inglês:

   ```
   `${key} “${title}” was stopped by its milestone's agent: ${reason}`
   (stopIf.length ? `Its stop conditions were: ${stopIf.join('; ')}.` : '')
   'Fix the task, not the code: rewrite it with plan_update update_task (sharper context with real paths, verify, stop_if), split it, or give it to the user (assignee "me") if it is a decision. Then plan_start_task if it should run again.'
   autopilot ? "Don't stop to ask the user: decide yourself." : 'Propose the change; the user approves it.'
   ```

4. `pilot.ts`, `stallOf`, na última linha: trate como `'working'` também a etapa que tem alguma
   tarefa em `m.run.stopped` que ainda não está terminada. Assim a escada de resgate chama o agente
   principal e, se nada mudar, passa para você. Confira em `rescue` (`case 'working'`, linha ~694)
   que o `kick` não reentrega a tarefa parada ao agente da etapa (ele usa `agentTasks`, que já a
   deixa de fora); se reentregar, pare e reporte.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 4: a tarefa volta à fila

Chame `plans.clearStopped(planId, taskId)`:
- em `plans.approved(...)` (`plans.ts:228`), para cada tarefa parada cuja `PlanTask` no `body` novo é
  diferente da do `body` anterior (compare com `JSON.stringify`) ou que saiu do plano. **Não** limpe
  em `editDraft`: ali a mudança ainda é só um rascunho, e em Check-ins a tarefa voltaria à fila sem a
  reescrita aprovada;
- no `start` de `toolsFor` em `src/core/plans/work.ts` (o que `plan_start_task` e o Start do
  usuário usam), para a tarefa iniciada.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 5: o texto do agente da etapa

Em `milestoneHow`:
1. Troque o item que o 002 pôs logo depois do item "A task only the user can decide…" (o que começa
   com `'- If one of a task\'s "Stop and say why if" happens, stop that task: say what you saw in one line with task_note on it`)
   por:
   `'- If one of a task\'s "Stop and say why if" happens, or its context is wrong, call task_stop on it with what you saw, and go on with the tasks that don\'t build on it. Never work around it.'`
2. O último item hoje é um ternário (`prompt.ts:545`):
   `only ? '- The user starts each task of this milestone: do only the task(s) you were given, then end your turn.' : '- When your last task is In Review, end your turn with one line per task.',`
   Troque-o por um spread, mantendo o ramo de `only` igual e pondo o relatório no outro, e no fim dos
   dois ramos:

   ```ts
   ...(only ? ['- The user starts each task of this milestone: do only the task(s) you were given, then end your turn.'] : ['- When your last task is In Review or stopped, end your turn with this report:']),
   '  STATUS: COMPLETE | STOPPED',
   '  TASKS: per task, done or stopped, and what each "Prove it" command printed',
   '  STOPPED BECAUSE: (only if stopped) which "Stop and say why if", and what you saw',
   '  NOTES: deviations, surprises, judgment calls',
   '  Report only what a tool result in this run shows; if a check failed or was skipped, say so.',
   ```

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 6: testes

Em `tests/plan-milestone-agent.test.ts`, com `running({ autonomy: 'autopilot' })` como o teste da
linha 229:

1. O agente da etapa chama `t.tools('safe').stop(key, 'the webhook table has no event id column')`
   (ou o nome que o `RunBoard` expuser): a tarefa tem a nota, `runs.safe.stopped` tem o registro,
   e o último texto ao `ws:main` contém "was stopped by its milestone's agent" e "Don't stop to ask".
2. Fim de turno (`t.run(w, 'done', ...)`) com só a tarefa parada sobrando: o agente da etapa **não**
   é mandado seguir por causa dela.
3. O planejador faz `update_task` nela (em Autopilot, aplicado na hora): o registro some, e a tarefa
   volta a ser entregue ao mesmo agente (como as tarefas de correção no teste da linha 229). Em
   Check-ins, o mesmo `update_task` **não** tira o registro até você aprovar (`t.work.approve(...)`).
3b. Só a tarefa parada sobrando e nada mudando: `stallOf` devolve `'working'` para a etapa.
4. Uma segunda chamada de `stop` na mesma tarefa, sem reescrita, não manda um segundo
   `stoppedPrompt`.
5. O texto do agente (teste da linha 127) contém `STATUS: COMPLETE | STOPPED` e `task_stop`.

**Verifique**: `npx vitest run tests/plan-milestone-agent.test.ts tests/plans.test.ts tests/board*.test.ts tests/companion-*` → todos passam, incluindo o "soak" de `plans.test.ts`.

### Passo 7: documentação

`docs/tasks-and-plans.md`, em "One agent per milestone": duas frases sobre `task_stop`, o que o
planejador recebe e quando a tarefa volta. Se `docs/parity.md` lista as ferramentas dos agentes,
acrescente `task_stop` (`npx vitest run tests/parity.test.ts` diz se falta).

## Pronto quando

- [ ] `npm run typecheck` sai com 0, também em `packages/companion`
- [ ] `npx vitest run tests/plan-milestone-agent.test.ts tests/plans.test.ts tests/board*.test.ts tests/companion-* tests/parity.test.ts` passa, com os novos
- [ ] `grep -n "task_stop" src/agent/board-tools.ts src/agent/policy.ts` acha as duas listas e a ferramenta
- [ ] `grep -n "ISSUE_STATUSES" src/core/board/model.ts` mostra a mesma lista de antes
- [ ] `git status` mostra só arquivos do escopo
- [ ] A linha deste plano no `README.md` desta pasta está atualizada

## Quando parar

- O 002 não está feito (passo 0).
- `agentTasks`, `BOARD_TOOL_NAMES`, a lista de `policy.ts` ou o `onAction` do pilot não estão como em
  "Como está hoje".
- Não há como fazer o callback chegar do `BoardWork` ao `PlansWork` sem mexer num arquivo fora do
  escopo (diga qual seria).
- Tirar a tarefa de `agentTasks` faz a etapa parecer "terminada" para o pilot (o verificador começa
  a checar com uma tarefa parada): reporte em vez de mexer em `progress.ts` além de `agentTasks`.
- O teste "soak" de `tests/plans.test.ts` falha ou passa a demorar o dobro.
- Um teste do passo 0 que passava falha duas vezes seguidas depois de uma tentativa de correção.

## Notas para quem mantém

- Uma tarefa parada que o planejador nunca reescreve fica parada; a escada de resgate leva isso até
  você por causa da linha nova em `stallOf`. Se o card de resgate não bastar na prática, o próximo
  passo é um card próprio no celular, com as regras do `CLAUDE.md` ("algo novo que espera por você").
- Na revisão, leia com cuidado o efeito em `agentsAtWork` (`progress.ts:433`): uma etapa cuja única
  tarefa restante está parada não deve contar como "trabalhando".
