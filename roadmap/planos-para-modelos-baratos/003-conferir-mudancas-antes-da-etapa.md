# Plano 003: antes de começar uma etapa, o agente sabe o que mudou desde que o plano foi escrito

> **Instruções para quem executa**: siga o plano passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes de seguir. Se acontecer qualquer item de "Quando parar",
> pare e reporte; não improvise. No fim, atualize a linha deste plano em
> `roadmap/planos-para-modelos-baratos/README.md`.
>
> **Conferência de mudanças (rode primeiro)**:
> `git diff --stat bdb82aa2..HEAD -- src/core/plans/model.ts src/core/plans/plans.ts src/core/plans/work.ts src/core/plans/pilot.ts src/core/plans/plan-git.ts src/core/plans/prompt.ts tests/plan-milestone-agent.test.ts`
> Se algum desses arquivos mudou, compare os trechos de "Como está hoje" com o código atual; se não
> baterem, isso é um motivo para parar.

## Situação

- **Prioridade**: P3
- **Esforço**: M
- **Risco**: MED (mexe no lançamento da etapa, que é assíncrono)
- **Depende de**: nenhum (combina com o 002, mas não precisa dele)
- **Categoria**: direction
- **Escrito em**: commit `bdb82aa2`, 2026-11-13
- **Modelo sugerido**: Sonnet 5.5, esforço `high`

## Por que importa

O planejador lê o código na pasta principal do projeto e escreve, no `context` de cada tarefa, como
ele está. O rascunho pode ficar dias esperando aprovação. Enquanto isso, alguém (você, outro agente,
um merge) muda o main. Ao aprovar, o branch do plano nasce do main **daquele momento**, e as
worktrees das etapas saem desse branch: o agente da etapa, que roda num modelo mais barato, encontra
um código diferente do que o `context` descreve e erra.

Depois deste plano, o plano guarda o commit em que o planejador leu o código (`plannedAt`). Quando
uma etapa começa, o Beluga compara esse commit com o de onde a worktree sai, e diz ao agente quais
arquivos da etapa mudaram **por fora do plano**. Só avisa; nunca bloqueia.

## Como está hoje

- `src/core/plans/model.ts:332` — `Plan.branch?: string` (`plan/<slug>`). `Plan.projectId` (linha
  ~308). Não há SHA guardado.
- O planejador grava o rascunho pelas ferramentas que `PlansWork.toolsFor(planId, external?)` monta,
  em `src/core/plans/work.ts:606`. As duas que escrevem (`write` e `update`) passam pela função
  `after(change)` (linha 609), que roda depois de cada gravação:

  ```ts
  const after = (change: () => Plan): string => {
    const before = plans.need(planId);
    const was = planTitle(before);
    const plan = change();
    this.nameHome(plan, was);
    this.syncHomeTask(plan);
    ...
  ```

- `PlansWork` recebe a git do plano em `deps.git?: PlanGit | null` (`work.ts:46`).
- `src/core/plans/plan-git.ts:11` — `interface PlanGit` (o pilot e o `PlansWork` só falam com o git
  por ela; os testes dão uma falsa). `plan-git.ts:33` — `planGitOf(controller)` implementa com
  `controller.manager` (`m`) e `root(projectId) = m.repoProject(projectId).root`.
- O git do repositório: `src/workspaces/git.ts` exporta `tryGit(dir, args)`: devolve a saída **sem
  aparar** (termina com quebra de linha), ou `undefined` quando o git falha. Exemplo:
  `src/workspaces/archive-git.ts:160`, `await tryGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])`.
- `src/core/plans/pilot.ts:860` — `private async launch(plan, milestoneId, by, only?, pick?)`. A ordem
  dentro do `try`: escolhe as tarefas; calcula
  `const base = resume ?? (first.bases?.length ? plan.branch : first.base);` (normalmente o branch do
  plano); cria a worktree (`await this.deps.work.startShared(...)`); grava o agente; calcula
  `const keys = ordered.map((t) => t.issue!.key);`; registra a nota `'started'`; e por fim manda o
  texto ao agente:

  ```ts
  this.deps.askClaude(milestonePrompt(now, mv, ordered.map((t) => all.get(t.task.id) ?? t), { only: Boolean(only) || mv.autonomy === 'step', ...(base ? { base } : {}) }), channel, false);
  ```

  Uma exceção dentro desse `try` marca as tarefas como falhas (`this.failed`): nada novo pode lançar.
- `src/core/plans/plans.ts:434` — `note(id, kind, text, by)` registra uma linha na atividade do plano
  (`kind: 'note'` serve).
- `src/core/plans/prompt.ts` — `export function milestonePrompt(view, m, tasks, opts: { only?; base? })`.
- Os testes do pilot: `tests/plan-milestone-agent.test.ts`. O `setup()` (linha ~40) aceita
  `opts.git` (uma `PlanGit` falsa, passada a `PlansWork`); a linha 284 mostra uma:
  `ensureBranch: async () => ({ made: true })`. `running()` (linha ~87) escreve o plano com
  `tools!.write(BODY)` e aprova.

## O que conta como "mudou por fora"

Para a etapa que vai começar, junte os `touches` das tarefas que vão para o agente (`mine`). Um
caminho **conta** quando:

1. ele aparece em `git diff --name-only <plannedAt> <base>` e está em `mine` ou dentro de um
   diretório de `mine`; **e**
2. ele **não** está nos `touches` de nenhuma tarefa de outro milestone do mesmo plano (o que o
   próprio plano já mudou no branch é esperado).

Sem `plannedAt` (planos antigos), sem `base`, ou com o git falhando: não conta nada e não avisa.

## Comandos

| Para quê | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sai com 0 |
| Testes | `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-branch.test.ts tests/plans.test.ts` | todos passam |

## Escopo

**Pode mudar:**
- `src/core/plans/model.ts` (um campo em `Plan`)
- `src/core/plans/plans.ts` (um método `setPlannedAt`)
- `src/core/plans/work.ts` (só a função `after` de `toolsFor`)
- `src/core/plans/plan-git.ts` (dois métodos opcionais)
- `src/core/plans/pilot.ts` (só `launch` e uma função pura nova)
- `src/core/plans/prompt.ts` (só `milestonePrompt`, uma opção nova)
- `tests/plan-milestone-agent.test.ts`
- `docs/tasks-and-plans.md`

**Não mexa:**
- `makeBranch`, `rescue`, `kick` e o resto do pilot.
- Nada no celular: o aviso chega pelo feed do plano, que já vai para lá.
- Nenhum bloqueio: a etapa sempre começa.

## Git

- Um commit, estilo `feat(plans): <frase>`. Não faça push.

## Passos

### Passo 0: linha de base

**Verifique**: o comando de testes da tabela → anote o que já falha.

### Passo 1: o campo e o método

1. `model.ts`, em `Plan`, logo abaixo de `branch?`:
   `/** The commit the plan was written against (the project's HEAD when the planner first saved this plan): drift is looked for from here. */ readonly plannedAt?: string;`
2. `plans.ts`: `setPlannedAt(id: string, sha: string): Plan`, que grava só se o plano ainda **não**
   tem `plannedAt` (fica o mais antigo: é o que o planejador leu primeiro), sem evento na atividade.
   Copie o formato de `setBranch` (`plans.ts:387`).

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 2: dois métodos opcionais na PlanGit

Em `plan-git.ts`, na interface (opcionais, para os fakes antigos continuarem valendo):

```ts
/** A ref's commit (undefined: git couldn't tell). */
head?(projectId: string, ref: string): Promise<string | undefined>;
/** Files changed between two commits (empty when git couldn't tell). */
changedFiles?(projectId: string, from: string, to: string): Promise<string[]>;
```

Em `planGitOf`, implemente com
`(await tryGit(root(projectId), ['rev-parse', '--verify', '--quiet', ref]))?.trim() || undefined` e
`((await tryGit(root(projectId), ['diff', '--name-only', from, to])) ?? '').split('\n').map((l) => l.trim()).filter(Boolean)`.
Importe `tryGit` de `../../workspaces/git.js` (o arquivo já importa tipos de lá).

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 3: gravar quando o planejador salva

Em `work.ts`, dentro de `after`, logo depois de `const plan = change();`:

```ts
const head = this.deps.git?.head;
if (head && !plan.plannedAt) void head.call(this.deps.git, plan.projectId, 'HEAD').then((sha) => sha && this.plans.setPlannedAt(plan.id, sha)).catch(() => undefined);
```

(Use o nome que o arquivo dá às dependências; se não for `this.deps`, siga o que as outras linhas da
classe usam.) Nada muda se `head` não existir.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 4: avisar ao lançar

1. Em `pilot.ts`, uma função pura exportada (para testar sem git):
   `export function driftedPaths(changed: readonly string[], mine: readonly string[], planned: readonly string[]): string[]`
   que aplica a regra de "O que conta como mudou por fora" (`mine`: os `touches` desta etapa;
   `planned`: os `touches` das tarefas dos outros milestones). Para "dentro de um diretório", copie a
   comparação de `sharedPaths` em `src/core/plans/coherence.ts:104`. Devolva no máximo 20, ordenados.
2. Em `launch`, **logo depois** de `const keys = ordered.map((t) => t.issue!.key);` (é preciso que
   `keys` já exista) e antes de `askClaude`:
   - se `plan.plannedAt`, `base` e `this.deps.git?.changedFiles` existem:
     `const changed = await this.deps.git.changedFiles(plan.projectId, plan.plannedAt, base).catch(() => [] as string[]);`
     e `drift = driftedPaths(changed, mine, planned)`;
   - se `drift` não está vazio, registre
     `this.deps.plans.note(plan.id, 'note', \`${keys.join(', ')}: ${drift.length} file(s) changed outside the plan since it was written\`, { kind: 'beluga' })`.
3. Passe `drift` para `milestonePrompt` numa opção nova `drift?: readonly string[]`. Em
   `milestonePrompt`, com `opts.drift`, logo antes da lista de tarefas, em inglês:
   `'These files changed outside the plan since it was written: ' + drift.join(', ') + '. Read them before the task that touches them; if a task\'s context no longer holds, say so with task_note on it and go on with the others.'`

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 5: testes

Em `tests/plan-milestone-agent.test.ts`:

1. `driftedPaths`: um caminho mudado que está em `mine` conta; um que está em `planned` não; um
   dentro de um diretório de `mine` (`src/webhooks/a.ts` com `mine: ['src/webhooks']`) conta; nada
   mudado → `[]`.
2. Com uma `PlanGit` falsa (copie a da linha 284) que tem `head: async () => 'abc'` e
   `changedFiles: async () => ['src/webhooks/retry.ts']`: depois de `running({ git })`, o plano tem
   `plannedAt: 'abc'`, o texto do agente do milestone cujo `touches` inclui `src/webhooks` contém
   "changed outside the plan", e a atividade do plano tem a nota. (Se o `head` assíncrono ainda não
   terminou quando o plano é aprovado, dê um `await tick(...)` entre o `write` e a aprovação.)
3. Uma segunda gravação do rascunho com `head: async () => 'def'` não troca o `plannedAt`.
4. A mesma falsa sem `changedFiles`: nenhum aviso, e o teste "its brief is lean…" (linha 127)
   continua igual.

**Verifique**: `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-branch.test.ts tests/plans.test.ts` → todos passam.

### Passo 6: documentação

`docs/tasks-and-plans.md`, em "The plan's branch": uma frase sobre `plannedAt` (o HEAD do projeto
quando o planejador salvou o plano pela primeira vez) e o aviso ao lançar uma etapa.

## Pronto quando

- [ ] `npm run typecheck` sai com 0
- [ ] `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-branch.test.ts tests/plans.test.ts` passa, com os novos
- [ ] `grep -n "plannedAt" src/core/plans/model.ts` acha o campo
- [ ] Todo `await` novo em `launch` tem `.catch` (leia o diff)
- [ ] `git status` mostra só arquivos do escopo
- [ ] A linha deste plano no `README.md` desta pasta está atualizada

## Quando parar

- `launch`, `toolsFor`/`after`, `setBranch` ou `PlanGit` não estão como em "Como está hoje".
- `base` não é um nome de branch ou commit que o git entenda (por exemplo, é um id interno):
  reporte o que encontrou.
- O teste "soak" de `tests/plans.test.ts` (um plano de cinco etapas em Autopilot) passa a falhar
  ou a demorar o dobro.
- Parece necessário bloquear a etapa ou mexer em `makeBranch` ou `rescue`.

## Notas para quem mantém

- `plannedAt` fica o primeiro SHA. Tarefas acrescentadas muito depois (um plano aprovado que muda)
  herdam esse SHA e podem avisar à toa; se incomodar, guarde um SHA por tarefa.
- O aviso também pega o que entra no branch do plano quando o main é mesclado nele (Resolve
  Conflicts), o que é desejado: também é mudança de fora.
- Na revisão, olhe se nenhum `await` novo em `launch` pode lançar exceção.
