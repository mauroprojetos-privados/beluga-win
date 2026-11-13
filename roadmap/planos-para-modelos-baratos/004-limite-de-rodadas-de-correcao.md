# Plano 004: uma etapa que reprova várias vezes volta para o planejador

> **Instruções para quem executa**: siga o plano passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes de seguir. Se acontecer qualquer item de "Quando parar",
> pare e reporte; não improvise. No fim, atualize a linha deste plano em
> `roadmap/planos-para-modelos-baratos/README.md`.
>
> **Conferência de mudanças (rode primeiro)**:
> `git diff --stat bdb82aa2..HEAD -- src/core/plans/model.ts src/core/plans/plans.ts src/core/plans/prompt.ts src/core/plans/work.ts src/core/plans/pilot.ts src/companion/needs-you.ts src/shared/i18n/areas/daemon.ts tests/plans.test.ts`
> Se algum desses arquivos mudou, compare os trechos de "Como está hoje" com o código atual; se não
> baterem, isso é um motivo para parar.

## Situação

- **Prioridade**: P2
- **Esforço**: M
- **Risco**: MED (muda o que acontece depois de uma reprovação, também em Autopilot)
- **Depende de**: 002 (o texto de reescrita pede `verify` e `stop_if`, campos que o 002 cria;
  confira com `grep -n "stop_if" src/agent/plan-tools.ts` antes de começar)
- **Categoria**: direction
- **Escrito em**: commit `bdb82aa2`, 2026-11-13
- **Modelo sugerido**: Sonnet 5.5, esforço `high`

## Por que importa

Quando o verificador reprova uma etapa, o agente principal do plano (o que planejou, no Opus) recebe
as notas e acrescenta tarefas de correção. Não há limite: em Autopilot, uma etapa pode reprovar,
ganhar correções, reprovar de novo, para sempre, gastando o modelo barato a cada volta. Quando as
correções não seguram, o problema quase sempre está no plano da etapa, não no código. Depois deste
plano:

- até a **2ª** reprovação: como hoje (tarefas de correção);
- da **3ª** em diante: o agente principal é instruído a **reescrever** a etapa em vez de só
  acrescentar tarefas;
- na **5ª**: o plano pausa e espera você (no Mac e no celular).

## Como está hoje

- `src/core/plans/model.ts` — `interface MilestoneRun` (linha ~151): `passedAt?`, `passedBy?`,
  `check?: GateCheck`, `checkAsked?`, `agent?`, `checker?`, `mergeFailed?`, `resumeFrom?`. Nada conta
  reprovações. `GateCheck` guarda só o último veredito.
- `src/core/plans/plans.ts:296` — `recordCheck(id, milestone, check)` grava o veredito:

  ```ts
  return this.change(plan, { runs: withRun(plan, milestone, { check: { ...check, notes, at }, checkAsked: asked }) }, [event(check.by, check.verdict === 'pass' ? 'checked' : 'failed', ...)]);
  ```

  `withRun` (linha 561) mescla o patch no `MilestoneRun` atual.
- `src/core/plans/prompt.ts:373` — o texto que o agente principal recebe quando a etapa reprova:

  ```ts
  export function checkFailedPrompt(title: string, notes: string, autopilot: boolean): string {
    return [
      `The checker of milestone “${title}” failed it. Its notes:`,
      '',
      notes.trim(),
      '',
      `Add the tasks that fix it to this milestone with plan_update (name the criterion each one fixes in its goal)${autopilot ? ': on Autopilot they apply at once and its Claude picks them up' : '; the user approves them'}.`,
      autopilot ? 'Don\'t stop to ask the user: decide the fix tasks yourself.' : '',
    ]
  ```

- Quem chama `checkFailedPrompt` (os dois precisam passar a contagem):
  - `src/core/plans/work.ts:567`, nas ferramentas do verificador (`gate`), depois de gravar o
    veredito: `this.deps.askClaude(checkFailedPrompt(m.title, notes, auto), plan.home, false);`
  - `src/core/plans/pilot.ts:703`, na escada de resgate (`case 'failed'`):
    `this.deps.askClaude(checkFailedPrompt(title, m.run.check?.notes ?? 'No notes.', true), plan.home, false);`
- Pausar: `plans.setPaused(id, paused, by, why?)` (`plans.ts:250`); um plano pausado não começa nada
  novo, e a escada de resgate não roda nele (`pilot.ts:394`). Por isso a linha 703 não precisa
  conferir a pausa: não acrescente essa checagem.
- Nova rodada de verificação: `plans.newRound(id, milestone)` (`plans.ts:288`) tira `check` e
  `checkAsked` da etapa e mantém o resto do `MilestoneRun` (vai manter `fails`).
- O celular: `src/companion/needs-you.ts:232` — `stuckItems(plan, progress, at)` monta os cards
  "esperando você" de um plano. Use como modelo o card `rescued` (linhas ~246–256): `kind: 'stuck'`,
  `keyed('daemon.needs.stuckOn', { title })`, `detail`, `askedAt`, `actions: []` (sem botões: abre o
  plano). **Não** use `plans.setPaused` como botão: ele é `mac` em `src/companion/coverage.ts:444`.
- Textos dos cards do daemon: `src/shared/i18n/areas/daemon.ts`, com as chaves em inglês num bloco
  (por exemplo `'daemon.needs.stuckOn': 'Stuck on “{title}”'`, linha 26) e as mesmas em português
  noutro (`'daemon.needs.stuckOn': 'Travado em “{title}”'`, linha 108).
- O teste que serve de modelo: `tests/plans.test.ts:454`, "the head Claude’s conversation stays
  free: a failed check reaches it with the notes, to add the fix tasks". Ele chama
  `t.work.forRun(\`ws:${checker}\`, 'p-me')!.tools!.gate('safe', 'fail', '...')` e lê o último texto
  mandado ao `ws:main`.

## Comandos

| Para quê | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sai com 0 |
| Testes | `npx vitest run tests/plans.test.ts tests/plan-milestone-agent.test.ts tests/companion-*` | todos passam |
| Tipos do celular | `cd packages/companion && npm run typecheck` | sai com 0 |

## Escopo

**Pode mudar:**
- `src/core/plans/model.ts` (um campo e duas constantes)
- `src/core/plans/plans.ts` (só `recordCheck`)
- `src/core/plans/prompt.ts` (só `checkFailedPrompt`)
- `src/core/plans/work.ts` (só o `gate` do verificador)
- `src/core/plans/pilot.ts` (só a linha 703)
- `src/companion/needs-you.ts` (só `stuckItems`)
- `src/shared/i18n/areas/daemon.ts` (uma chave nova, nos dois blocos)
- `tests/plans.test.ts`, um teste do Needs You
- `docs/tasks-and-plans.md`

**Não mexa:**
- `rescue` além da linha 703, `kick`, `launch`.
- `src/companion/coverage.ts` e `protocol.ts`: o card usa um `kind` que já existe (`stuck`).
- A tela do Mac: o plano pausado já mostra Resume.

## Git

- Um commit, estilo `feat(plans): <frase>`. Não faça push.

## Passos

### Passo 0: linha de base

**Verifique**: o comando de testes da tabela → anote o que já falha.

### Passo 1: contar reprovações

1. `model.ts`, em `MilestoneRun`: `/** How many times its check failed (fix rounds so far). */ readonly fails?: number;`
2. `model.ts`, exportadas: `export const FIX_ROUNDS = 2;` (até aqui, só tarefas de correção) e
   `export const FAILS_TO_PAUSE = 5;` (aqui o plano pausa).
3. `plans.ts`, `recordCheck`: quando `check.verdict === 'fail'`, inclua no patch
   `fails: (plan.runs[milestone]?.fails ?? 0) + 1`. Com `'pass'`, não mexa em `fails`.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 2: o texto muda depois de duas rodadas

`checkFailedPrompt(title, notes, autopilot, fails = 1)`:

- `fails <= FIX_ROUNDS`: exatamente como hoje (o teste da linha 454 não pode mudar).
- `fails > FIX_ROUNDS`: no lugar da linha "Add the tasks that fix it…", em inglês:

  ```
  `This is failure ${fails} of “${title}”: fix tasks didn't hold, so the milestone itself needs rewriting. Call plan_get, read the milestone and these notes, and work out why the fixes failed. Then rewrite its tasks with plan_update (update_task, remove_task, add_task): sharper context with the real file paths, a verify command for each criterion, and stop_if for what you can't confirm. Don't only add another fix task.`
  ```

  e mantenha a linha final de Autopilot ("Don't stop to ask the user…").

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 3: passar a contagem e pausar na quinta

1. `work.ts:567`: leia `fails` do plano **depois** de `full.gate(...)` gravar
   (`this.plans.need(planId).runs[m.id]?.fails ?? 1`) e passe para `checkFailedPrompt`.
2. No mesmo lugar, se `fails >= FAILS_TO_PAUSE`: em vez de pedir ao agente principal, chame
   `this.plans.setPaused(planId, true, { kind: 'beluga' }, \`“${m.title}” failed its check ${fails} times\`)`
   e devolva `'Recorded as failed. The plan is paused for the user: this milestone failed too many times. End your turn.'`.
3. `pilot.ts:703`: passe `m.run.fails ?? 1` como quarto argumento. Não mexa no resto do `case`.

**Verifique**: `npm run typecheck` → sai com 0.

### Passo 4: o card no celular

1. `src/shared/i18n/areas/daemon.ts`, ao lado de `daemon.needs.stuckOn` nos dois blocos:
   `'daemon.needs.failingMilestone': '“{title}” failed its check {count} times: the plan is paused',`
   e `'daemon.needs.failingMilestone': '“{title}” reprovou {count} vezes: o plano está pausado',`.
   Se o catálogo exige a mesma chave nos dois blocos, o typecheck avisa.
2. `needs-you.ts`, em `stuckItems`: para cada etapa com `run.fails >= FAILS_TO_PAUSE` e `plan.paused`,
   um card `{ id: \`plan:${plan.id}:failing:${milestoneId}\`, kind: 'stuck', ...keyed('daemon.needs.failingMilestone', { title, count }), detail: clip(plainLine(run.check?.notes ?? '', 4000), 4000), ...at, askedAt: run.check?.at ?? plan.updatedAt, actions: [] }`.
   `stuckItems` começa com `if (plan.status !== 'active') return [];`. Um plano pausado continua
   `active` (`paused` é um campo à parte, `Plan.paused` em `model.ts:325`), então o card aparece.

**Verifique**: `npm run typecheck` → sai com 0; `cd packages/companion && npm run typecheck` → sai com 0.

### Passo 5: testes

Em `tests/plans.test.ts`, ao lado do teste da linha 454, com o mesmo arranjo:

1. Reprovar a etapa 3 vezes pelo verificador (`gate('safe', 'fail', ...)`). Entre uma reprovação e
   a seguinte, abra a nova rodada com `t.plans.newRound(t.plan.id, 'safe')`, dê `await tick(5)` e
   pegue o verificador de novo em `t.plans.need(t.plan.id).runs.safe!.checker!` (as tarefas já estão
   em `in_review`; movê-las não abre rodada nenhuma). O 1º e o 2º textos ao `ws:main` contêm "Add
   the tasks that fix it"; o 3º contém "failure 3" e "Don't only add another fix task". Se o pilot
   não pedir a checagem de novo depois do `newRound`, pare e reporte como a rodada é aberta.
2. Reprovar 5 vezes: o plano fica `paused`, o 5º veredito **não** manda nada novo ao `ws:main`, e
   `needsYou(...)` (como em `tests/plan-coherence.test.ts`, que importa
   `needsYou` de `src/companion/needs-you.js`) tem um item com id `plan:<id>:failing:safe`.
3. `recordCheck` com `pass` depois de uma reprovação mantém `fails` em 1.

**Verifique**: `npx vitest run tests/plans.test.ts tests/plan-milestone-agent.test.ts tests/companion-*` → todos passam.

### Passo 6: documentação

`docs/tasks-and-plans.md`, no item "Gates": uma frase sobre as duas rodadas de correção, a
reescrita da etapa a partir da 3ª reprovação e a pausa na 5ª, com o card no celular.

## Pronto quando

- [ ] `npm run typecheck` sai com 0, também em `packages/companion`
- [ ] `npx vitest run tests/plans.test.ts tests/plan-milestone-agent.test.ts tests/companion-*` passa, com os novos
- [ ] O teste "the head Claude’s conversation stays free…" (linha 454) passa sem ter sido alterado
- [ ] O teste "soak" de `tests/plans.test.ts` passa
- [ ] `git status` mostra só arquivos do escopo
- [ ] A linha deste plano no `README.md` desta pasta está atualizada

## Quando parar

- `checkFailedPrompt`, `recordCheck`, o `gate` do verificador ou a linha 703 do pilot não estão como
  em "Como está hoje".
- Não dá para reprovar a mesma etapa duas vezes seguidas no teste mesmo com `newRound` (o segundo
  `gate` é recusado): reporte, em vez de contornar.
- O card exigiria um botão que o celular não pode usar.
- O teste "soak" passa a falhar.

## Notas para quem mantém

- `fails` nunca volta a zero; se um dia uma etapa puder ser reaberta depois de passar, zere ali.
- Os números (2 e 5) estão em duas constantes de `model.ts`; se virarem configuração, o lugar é
  Settings › Advanced, nunca um botão a mais (regra do `CLAUDE.md`).
- Na revisão, confira que o texto das duas primeiras reprovações não mudou (o teste da linha 454).
