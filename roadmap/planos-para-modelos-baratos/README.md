# Planos de execução: planos que um modelo barato consegue executar

Detalhamento das fases 1 a 4 de [../planos-para-modelos-baratos.md](../planos-para-modelos-baratos.md),
escrito em 2026-11-13 contra o commit `bdb82aa2`, no formato da skill
[shadcn/improve](https://github.com/shadcn/improve) (MIT): cada plano traz o código de hoje, os
comandos que provam cada passo, o que não tocar e quando parar.

Quem executa: leia o plano inteiro antes de começar, rode a conferência de mudanças do topo, siga os
passos na ordem, respeite "Quando parar" e atualize a sua linha aqui ao terminar.

## Ordem e situação

| Plano | O que fica verdade | Fase do roadmap | Prioridade | Esforço | Risco | Depende de | Modelo | Situação |
|---|---|---|---|---|---|---|---|---|
| [001](001-preset-por-papel-padrao.md) | "Opus planeja, Sonnet constrói" vale em toda máquina com o Claude | 1 | P1 | S | LOW | — | Sonnet 5.5 | DONE (não commitado; o plano corrigido para esperar `state: 'ready'`) |
| [002](002-tarefas-para-o-executor.md) | cada tarefa diz como se prova, o que não tocar e quando parar | 2 | P1 | M | LOW | — | Sonnet 5.5 | DONE (não commitado) |
| [004](004-limite-de-rodadas-de-correcao.md) | uma etapa que reprova várias vezes volta para o planejador | 4 (parte) | P2 | M | MED | 002 | Sonnet 5.5, `high` | DONE (não commitado) |
| [005](005-parar-com-motivo.md) | o agente da etapa para uma tarefa com motivo, e o planejador a reescreve | 4 (parte) | P2 | L | HIGH | 002 | Sonnet 5.5 `high`, Opus 5.5 se reprovar | DONE (não commitado; `task_stop` classificada `chat_only` para agentes externos, e uma tarefa em andamento volta para To Do ao parar) |
| [003](003-conferir-mudancas-antes-da-etapa.md) | antes de começar uma etapa, o agente sabe o que mudou desde o plano | 3 | P3 | M | MED | — | Sonnet 5.5, `high` | DONE (não commitado; o git vem de `planGitOf` em produção, não de `deps.git`) |

Situações: TODO · IN PROGRESS · DONE · BLOCKED (com o motivo em uma linha) · REJECTED (com o porquê).

A ordem recomendada é a da tabela: 001 e 002 primeiro (o maior ganho com o menor risco), depois 004,
005 e, por último, 003. Prefira um de cada vez. O 001 pode rodar ao lado de qualquer outro (não
divide arquivos com eles); 002, 003 e 004 mexem em `src/core/plans/model.ts` e `prompt.ts`, em
funções diferentes, então em paralelo o segundo a terminar resolve um conflito pequeno.

## Dependências

- **005 depende do 002**: usa o campo `stopIf` e substitui a linha "Stop and say why if" que o 002
  coloca no texto do agente da etapa.
- **004 depende do 002**: o texto de reescrita pede ao planejador `verify` e `stop_if`, que o 002 cria.
- 002 e 005 mudam `milestoneHow` (`src/core/plans/prompt.ts`); rodando o 005 depois do 002, não há
  conflito.

## Como executar no próprio Beluga

Abra um New Plan no `beluga-win` com o objetivo "executar `roadmap/planos-para-modelos-baratos/`, na
ordem do README", com o Plan head no Opus e os milestones no Sonnet (o preset "Claude by kind of
work"). Uma etapa por plano daqui, em Check-ins, para você aprovar cada uma.

Ou à mão, em qualquer agente: "implemente `roadmap/planos-para-modelos-baratos/001-preset-por-papel-padrao.md`".

## Antes de cada commit (CLAUDE.md)

`npm run typecheck`, `npx vitest run` inteiro depois da última mudança, e `npm run typecheck` em
`packages/companion`. Neste Windows, a suíte inteira tem falhas conhecidas do ambiente (links
simbólicos sem o Modo de Desenvolvedor, locale pt-BR, CRLF): compare com a linha de base do passo 0
de cada plano, e não acrescente a linha `Tested-on` (ela só sai num Mac).

## O que ficou de fora

- **Fase 5 (modo Auditar)**: fica para depois de estes planos rodarem algumas semanas, como diz o
  roadmap.
- **Levar os campos novos para o brief do board** (002): mudaria o Mac e o celular inteiros; o
  agente da etapa já os recebe pelo texto da etapa.
- **Bloquear uma etapa por mudanças de fora** (003): só avisa; parar é decisão do agente.
- **Um status novo de tarefa "parada"** (005): a parada fica registrada no plano, não no board.
- **Um card próprio no celular para tarefa parada** (005): quem resolve primeiro é o planejador; a
  escada de resgate que já existe (com uma linha nova em `stallOf`) leva até você o que ele não
  resolver, pelo card de resgate.
