# Planos que um modelo barato consegue executar

> Objetivo: o modelo caro (Opus) entende o código, decide o que vale a pena e escreve o plano; os
> modelos baratos (Sonnet, Haiku) executam. E isso por **padrão**, sem configurar nada. A ideia vem
> da skill [shadcn/improve](https://github.com/shadcn/improve) (MIT): *o plano é o produto*, escrito
> para o executor mais fraco possível, com verificação em cada passo e condições de parada.

Status: fases 1 a 4 feitas e vistas num plano real · fase 5 proposta · atualizado em 2026-11-13

As fases 1 a 4 estão detalhadas, e foram executadas por um modelo mais barato, em
[planos-para-modelos-baratos/](planos-para-modelos-baratos/README.md) (a fase 4 virou dois planos,
004 e 005).

O desenho técnico, quando cada fase sair, vai para `docs/tasks-and-plans.md` e `docs/routing.md`
(em inglês, como o resto de `docs/`).

## 1. O que o Beluga já tem (não reinventar)

| Peça | Onde | O que faz hoje |
|---|---|---|
| Opus planeja, Sonnet constrói, Haiku explora | `src/core/routing/presets.ts` (`CLAUDE_KIND_ROLES`, `CLAUDE_KIND_CATEGORIES`) | papéis do plano e tipos de trabalho apontando para combos só de Claude, cada um caindo para o próximo modelo no limite |
| Quando o preset liga | `claudeByKindOnce` (`src/core/stack/launch.ts:32`) | uma vez, só se você nunca escolheu combos por tipo ou papel; **mas só roda dentro de `launchStack`, que exige rede ligada e fora do demo** (`src/daemon/core.ts:461`) |
| Tarefa de plano | `PlanTask` (`src/core/plans/model.ts:39`), ferramenta `TASK` (`src/agent/plan-tools.ts:21`) | goal, context, acceptance, touches, blockers, estimate |
| Como cortar um plano | `HOW_TO_PLAN` (`src/core/plans/prompt.ts:64`) | ler o código, milestones verificáveis, `touches`, critérios checáveis |
| O que o agente da etapa lê | `taskBlock` e `milestoneHow` (`src/core/plans/prompt.ts:509`) | goal, context, arquivos, "Done means", handoff |
| Verificador separado | `checkerBrief`, `plan_gate`, `checkFailedPrompt` | um agente que não escreveu o código checa os critérios; reprovou, o agente principal cria tarefas de correção |
| Plano coerente | `coherence.ts`, decisões (`Decided`) | avisos a cada `plan_write`, decisões com `supersedes` |
| Plano não trava calado | `rescue` em `pilot.ts` | escada de tentativas e depois é com você |

**O que falta, comparando com o improve:**

1. O preset não é padrão em toda máquina (depende da rede e do `stack.json`).
2. A tarefa não diz **como provar** cada passo (comando e resultado esperado), **o que não tocar**,
   nem **quando parar**. Um Sonnet ou um Haiku improvisa onde um Opus pararia.
3. Ninguém confere se o código mudou entre o plano aprovado e o começo da etapa.
4. O agente da etapa não tem como dizer "parei porque X" de um jeito que o planejador entenda, e as
   rodadas de correção não têm limite.
5. O que o planejador olhou e descartou não fica registrado, e volta na próxima conversa.
6. Não existe um "audite o projeto e me diga o que vale a pena", que é o `/improve` em si.

## 2. Fases

Cada fase é um commit (ou PR) com testes. As fases 1 a 4 são pequenas e independentes entre si
depois da 1; a 5 é a maior e fica por último.

### Fase 1: padrão de verdade

**O que muda:** "Claude por tipo de trabalho" passa a valer em toda instalação nova, com ou sem
rede, e continua respeitando quem já escolheu combos.

- Tirar a chamada de `claudeByKindOnce` de dentro de `launchStack` e fazer o daemon chamá-la no
  início, sempre (inclusive sem `opts.network`). No demo, continua de fora.
- A regra fica igual: só se `prefs.categoryCombos` e `prefs.roleCombos` estão vazios, e uma vez só
  (registrado no `stack.json`). Limpar depois é escolha sua.
- Se o Claude não estiver instalado nesta máquina, o preset não liga (os combos ficariam vazios);
  tenta de novo no próximo início.
- Settings › Agent › Combos ganha uma linha: "Planeja no Opus, constrói no Sonnet" com **Use the
  Defaults** voltando a isso.

**Arquivos:** `src/core/stack/launch.ts`, `src/daemon/core.ts`, `packages/mac` (a linha em Combos).

**Pronto quando:**
- `npx vitest run tests/` (o teste de `claudeByKindOnce`; ache com `grep -rl claudeByKindOnce tests`)
  passa com um caso novo: daemon sem rede liga o preset uma vez.
- Um caso novo: com `roleCombos` já salvo, nada muda.
- `npm run typecheck` limpo.

**Celular:** nada novo (Settings › Routing já mostra os papéis).

### Fase 2: tarefas escritas para o executor mais fraco

**O que muda:** cada tarefa de plano pode levar quatro campos novos, e o planejador é instruído a
preenchê-los sempre que a tarefa tiver estimativa 2 ou mais.

| Campo | Tipo | Para quê |
|---|---|---|
| `verify` | `{ run: string; expect: string }[]` (até 8) | o comando que prova cada passo e o que deve sair (`npx vitest run tests/x.test.ts` → "todos passam") |
| `outOfScope` | `string[]` (até 10) | arquivos ou áreas que parecem relacionados mas não devem ser tocados |
| `stopIf` | `string[]` (até 6) | "se X, pare e reporte" em vez de improvisar |
| `exemplar` | `string` (um caminho) | um arquivo do repositório que já segue a convenção a copiar |

- `PlanTask` (`model.ts`), `TASK` e `taskInput` (`plan-tools.ts`), o zod de `plans.ts:76` (já é
  `passthrough`, mas o tipo precisa ser explícito), `apply.ts` levando os campos para o brief do
  board.
- `taskBlock` (`prompt.ts:509`) mostra os quatro, e `milestoneHow` ganha duas linhas: rode cada
  `verify` e confirme o `expect` antes de marcar o critério; se um `stopIf` acontecer, pare essa
  tarefa (ver fase 4) e siga com as outras que não dependem dela.
- `HOW_TO_PLAN` ganha um bloco "Escreva para um modelo menor, que nunca viu esta conversa": tudo que
  ele precisa no `context` (caminhos exatos, como o código está hoje, em poucas linhas), um `verify`
  por critério, `outOfScope` para o que é tentador mexer, `stopIf` para o que você não conseguiu
  confirmar lendo o código, e um `exemplar`.
- `coherence.ts` ganha um aviso: tarefa com estimativa ≥ 2 sem `verify`, ou com `touches` que
  aparece no `outOfScope` de outra tarefa do mesmo milestone.

**Pronto quando:**
- `npx vitest run tests/plan-coherence.test.ts tests/plan-milestone-agent.test.ts` passa, com casos
  novos: os campos vão de `plan_write` até o texto de `milestonePrompt`; o aviso aparece e some.
- `npm run typecheck` limpo, também em `packages/companion`.

**Celular:** a página da tarefa (`TaskPageView`, `views.ts:982`) mostra `stopIf` e quantas
verificações a tarefa tem. **Os comandos de `verify` não vão para o celular** (são código; o
`CLAUDE.md` manda não mostrar código fora de Files). Campo novo e aditivo em `protocol.ts`, minor
1.56, `SINCE.taskGuards`.

### Fase 3: commit de referência e conferência antes de começar

**O que muda:** o plano guarda o commit em que foi aprovado; quando uma etapa começa, o Beluga
confere se os arquivos dela mudaram desde então e avisa o agente.

- `Plan.approvedAt` ganha `approvedSha` (o `HEAD` do branch do plano ao aprovar, em `apply.ts`).
  Cada aprovação de mudança atualiza o SHA.
- Ao lançar o agente do milestone (`launch` em `pilot.ts`): `git diff --name-only <sha>..<base>`
  limitado aos `touches` das tarefas dele.
  - Nada mudou: segue como hoje.
  - Mudou: `milestonePrompt` ganha "estes arquivos mudaram desde o plano: releia-os antes; se o
    `context` de uma tarefa não vale mais, use o `stopIf`", e a atividade do plano registra
    "KLD-12: 3 arquivos mudaram desde o plano".
- Nunca bloqueia sozinho: avisar é barato, e parar é decisão do agente com o `stopIf`.

**Pronto quando:**
- `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-branch.test.ts` passa, com um caso
  de repositório temporário: um commit em um `touches` entre aprovar e lançar faz o aviso aparecer.
- Sem `approvedSha` (planos antigos), nada muda.

**Celular:** a linha da atividade já chega pelo feed do plano. Nada novo no protocolo.

### Fase 4: o executor sabe parar, e as correções têm limite

**O que muda:** o agente da etapa tem como dizer "parei" com o motivo, isso vai para o planejador
(Opus) reescrever a tarefa, e um milestone que reprova muitas vezes volta para o planejador em vez
de girar.

- Ferramenta nova `task_stop` (ou `task_update` com `status: "stopped"` e `reason`): a tarefa sai de
  In Progress, guarda o motivo no handoff, e o agente segue com as que não dependem dela.
- O pilot manda para o agente principal um `stoppedPrompt(key, reason, stopIf)`: "reescreva a tarefa
  com o que aprendeu (`update_task`), ou divida, ou passe para você (`assignee: "me"`) se for uma
  decisão". Em Check-ins ele propõe e você aprova; em Autopilot aplica.
- `MilestoneRun.failedChecks` conta reprovações. Na **terceira**, em vez de mais tarefas de
  correção, o agente principal é instruído a reler o milestone inteiro e reescrevê-lo
  (`checkFailedPrompt` com um modo "replan"); em Autopilot o plano para ali e espera você.
- O agente da etapa termina o turno com um relatório fixo, que o verificador e o principal leem:

  ```
  STATUS: COMPLETE | STOPPED
  TASKS: por tarefa — feita/parada + o resultado de cada verify
  STOPPED BECAUSE: (só se parou) qual stopIf, o que viu
  NOTES: desvios, surpresas, decisões tomadas
  ```

  E a regra do improve: só reportar o que tem prova numa saída de ferramenta desta sessão.

**Pronto quando:**
- `npx vitest run tests/plan-milestone-agent.test.ts tests/plan-checker-view.test.ts tests/plans.test.ts`
  passa, com: uma tarefa parada chega ao principal uma vez; três reprovações viram "replan"; o soak
  de Autopilot de `plans.test.ts` continua chegando ao fim.
- `npm run typecheck` limpo.

**Celular:** uma tarefa parada aparece como "Parada: motivo" na página da tarefa. Se em Autopilot o
plano parar na terceira reprovação, isso já espera você pelo caminho do plano; conferir que chega
como `NeedsYou` com ação (Abrir o plano) e, se não chegar, adicionar o tipo aos cards do celular
(regra "algo novo que espera por você" do `CLAUDE.md`). Minor 1.56, junto com a fase 2.

### Fase 5: modo Auditar (o `/improve` dentro do Beluga)

**O que muda:** o New Plan ganha **Auditar primeiro**. Em vez de você escrever o objetivo, o Opus
lê o projeto, mostra o que vale a pena fazer, e você escolhe o que vira plano.

1. **Reconhecimento:** README, `CLAUDE.md`, configs, CI, `docs/adr/` e afins; os comandos exatos de
   build, teste e lint, que depois entram em todo `verify`.
2. **Auditoria em paralelo:** sub-agentes só de leitura no Haiku (o `explorador` da fase 0 do
   roteamento), um por categoria: correção, segurança, desempenho, testes, dívida técnica,
   dependências, DX, docs e direção. Cada achado com `arquivo:linha`, impacto, esforço e confiança.
3. **Conferência:** o Opus reabre cada trecho citado antes de mostrar. Sub-agentes exageram; o que for
   descartado vai para a lista de rejeitados do plano com o motivo.
4. **Tabela por alavancagem** (impacto ÷ esforço, pesado pela confiança) na conversa do plano; a
   direção (o que construir depois) vem separada.
5. **Você escolhe** ("1, 3 e 5"), e só então ele escreve o plano, com as tarefas da fase 2.

- `PlanBody` ganha `rejected: { text; why; at }[]` e a operação `reject` em `plan_update`; o
  planejador lê essa lista antes de propor e não repete o que está lá. Vale também fora do modo
  Auditar.
- O texto das categorias e do formato de achado é uma adaptação do `audit-playbook.md` do improve,
  com o aviso de licença MIT em `docs/tasks-and-plans.md`.
- Variante **Auditar esta branch**: só os arquivos que a branch mudou, cada achado marcado como
  "introduzido" ou "já existia".

**Arquivos:** `src/core/plans/prompt.ts` (um `auditBrief`), `model.ts`, `plan-tools.ts`,
`src/ipc/plans-api.ts` (`plans.create` com `audit`), `packages/mac/src/plans/` (o cartão no New
Plan), `src/companion/coverage.ts`.

**Pronto quando:**
- Um teste com agente falso: o modo Auditar não chama `plan_write` antes da escolha; um achado
  rejeitado não volta na rodada seguinte.
- `tests/parity.test.ts` passa com a entrada nova em `docs/parity.md`.

**Celular:** começar um plano com auditoria é "perguntar", então é `phone` em `coverage.ts`; a
tabela de achados chega como texto da conversa (sem código, por `stripCode`).

## 3. Regras do repositório (CLAUDE.md)

- Método novo ou mudado em `src/ipc/*-api.ts` → classificar em `src/companion/coverage.ts`.
- Campos novos em `src/companion/protocol.ts` só aditivos (minor 1.56); nada de código no celular:
  `verify` fica no Mac.
- `docs/parity.md` atualizado a cada item de UI novo (Auditar primeiro, a linha em Combos).
- Antes de cada commit: `npm run typecheck`, `npx vitest run`, e `npm run typecheck` em
  `packages/companion`. A suíte inteira depois da última mudança.

## 4. Riscos

- **Planos mais longos custam mais Opus.** Os campos novos só são exigidos a partir da estimativa 2,
  e o `context` continua limitado (8.000 caracteres). Medir em Usage › Combos se o custo do
  planejamento subiu mais do que a economia na execução.
- **`verify` errado vira prova falsa.** O verificador continua lendo o diff e os testes, não só
  rodando os comandos (a regra do improve: executores "jogam" o critério com testes que não testam
  nada).
- **Parar demais.** `stopIf` demais faz o Sonnet parar à toa. O prompt pede só o que o planejador
  não conseguiu confirmar lendo o código, no máximo 6.
- **Mudança de comportamento para quem já usa.** A fase 1 nunca sobrescreve combos já escolhidos.

## 5. Ordem sugerida

1. Fase 1 (padrão): pequena, e o resto depende de o Opus estar planejando.
2. Fase 2 (tarefas para o executor fraco): onde está o maior ganho.
3. Fases 3 e 4, em qualquer ordem; a 4 aproveita os `stopIf` da 2.
4. Fase 5 (Auditar), quando as outras estiverem rodando há algumas semanas.

Dá para executar este próprio roadmap como um plano do Beluga: New Plan com o objetivo "fases 1 a 4
de `roadmap/planos-para-modelos-baratos.md`", com o Plan head no Opus e os milestones no Sonnet.

## 6. O teste real (2026-11-13)

Um plano de verdade no `beluga-win`, com o daemon deste checkout e uma pasta de dados à parte:

| O quê | Resultado |
|---|---|
| Fase 1 | Num daemon novo, os papéis vieram sozinhos: o planejador rodou no Opus ("Claude: Opus first", $0,77), o agente da etapa no Sonnet ("Claude: Sonnet first") |
| Fase 2 | O Opus escreveu a tarefa de 2 pontos com 2 `verify`, 3 `outOfScope`, 2 `stopIf` e um `exemplar`, sem ninguém pedir campo a campo |
| Fase 3 | Ao lançar a etapa, o aviso "2 file(s) changed outside the plan" disparou com razão (o branch do plano saiu do `main`, sem os commits do dia) |
| Fase 4 (parar) | Em 37 s o Sonnet chamou `task_stop` com o motivo exato e não mudou nada ($0,30); o Opus achou a causa e propôs reescrever o plano com uma decisão para você ($0,21) |
| Fase 4 (rodadas) | Não exercitada: nenhuma etapa chegou a ser verificada |

O que ele ensinou:

- **Um plano sempre sai do `main`.** Enquanto a `feat/windows-port` não estiver no `main`, um plano
  nesta pasta trabalha sobre código mais antigo.
- **`ready` não garantia o login.** `claude auth status --json` diz `loggedIn: true` mesmo com o
  login vencido; o primeiro plano falhou com "OAuth session expired and could not be refreshed".
  Corrigido: `loginExpiresAt` no passado conta como sem login, e uma execução que termina sem login
  faz o Beluga verificar o Claude de novo (`src/agent/runtime/claude/status.ts`,
  `src/core/workbench.ts`).
- **O planejador conferiu antes de planejar**, e corrigiu uma premissa errada do pedido (esvaziar os
  campos de uma tarefa já funcionava).

## 7. Decisões (registro)

- **O plano é o produto.** O planejador não implementa; quem executa nunca viu a conversa do plano.
- **Os comandos de verificação não vão para o celular**; ele vê os `stopIf` e quantas verificações há.
- **A conferência de mudanças só avisa, nunca bloqueia.** Parar é decisão do agente, pelo `stopIf`.
- **Três reprovações devolvem o milestone ao planejador**, em vez de uma quarta rodada de correções.
- **Não instalar a skill improve no repositório.** Adaptamos as ideias e os textos (MIT, com crédito)
  dentro dos planos do Beluga, que já têm board, worktrees, verificador e celular.

## Referências

- [shadcn/improve](https://github.com/shadcn/improve): `skills/improve/SKILL.md`,
  `references/plan-template.md`, `references/closing-the-loop.md`, `references/audit-playbook.md`.
- `docs/tasks-and-plans.md` (planos, milestones, verificador), `docs/routing.md` (combos e papéis),
  `roadmap/roteamento-inteligente.md` (fases 3 e 4).
