# Modo orquestrador

> Objetivo: em qualquer conversa do Beluga (projeto, worktree, Your Mac, bot), um modelo forte pensa,
> decide e edita, e modelos baratos (Haiku, Codex, um modelo local) fazem o trabalho braçal de busca,
> leitura e testes, devolvendo um resumo. Configurado num lugar só, e com a conversa compactando a
> tempo para não estourar o plano.

Status: proposta · criado em 2026-11-15

## 1. O que está errado hoje

Medido no motor que roda no WSL (`~/.beluga`, 2026-11-15):

| Sintoma | Causa | Onde |
|---|---|---|
| **Não compacta** | `autoCompact` está `false`. Uma migração desliga todo `autoCompact: true` que não foi escolhido de propósito (`autoCompactChosen`), então quem não ligou de novo ficou sem compactação | `src/core/settings.ts:29-35`, `~/.beluga/settings.json` |
| **Mesmo ligado, compacta tarde demais** | O limiar é uma % da janela (70–95, padrão 85). Opus/Sonnet 4.6+ e Claude 5 têm janela de 1M: compacta só com ~850k tokens, e até lá cada turno relê o contexto inteiro | `src/shared/context-usage.ts:7-21,100-103` |
| **Estoura o plano** | Conversas longas sem compactar, `parallelRuns: 10`, `autoContinue: true` (volta a rodar sozinho depois do reset) e nenhum orçamento por conversa, bot ou dia. Uso registrado: 13,0M tokens em 12/11, 10,8M em 14/11 | `src/shared/run-slots.ts:7-9`, `src/shared/auto-continue.ts`, `~/.beluga/stats.json` |
| **Sub-agentes no modelo caro** | O Beluga não passa `agents` ao SDK nem define o modelo dos sub-agentes. Um sub-agente sem modelo herda o principal: um Opus que delega uma busca paga Opus por ela | `src/agent/runtime/claude/runner.ts:215-283` (sem `agents`); `AgentDefinition.model` no SDK 0.3.301 |
| **Não dá para configurar "quem pensa / quem executa"** | Há três mapas diferentes (combos por execução, `roleCombos` por papel de plano, `categoryCombos` por tarefa), mas todos escolhem o modelo **de uma execução inteira**. Nada escolhe o modelo de quem trabalha **dentro** da conversa | `src/core/routing/`, Settings › Agent |
| **O Stack economiza pouco** | RTK poupou 1,3M tokens (21,9%) e token-goat 2M em 30 dias, contra 10–13M gastos por dia. No erp-rewrite o índice do GitNexus está velho e o do graphify nunca foi construído, então o agente volta a ler arquivos inteiros. `gls usage savings` não tem nenhum registro (a ordem de leitura não é usada). O token-goat só existe como regra no CLAUDE.md, sem hook. Ollama não está instalado | `docs/stack.md`, `~/.claude/CLAUDE.md` e `~/.claude/settings.json` no WSL, `gls index --check` |
| **Custo fixo por turno** | Um "oi" à Clara ocupa 53k tokens de contexto (persona, regras do Stack, ferramentas e MCPs de todos). Cada sub-agente que herda tudo paga o mesmo | evento `context` da execução, 2026-11-15 |
| **Executor só pode ser Claude** | Um sub-agente do Claude Code roda no Claude. Codex, OpenCode ou Ollama só entram como outra execução (`plan_dispatch`, que é assíncrono, por plano e cria worktree) | `src/core/bots/dispatch.ts`, `src/agent/mac-tools.ts` |

O que já existe e será reaproveitado (não reinventar):

- **Combos** (`settings.combos`): cadeias ordenadas de runtime + modelo com fallback no limite de uso (`src/core/routing/failover.ts`).
- **Categorias** (`categoryCombos`): o usuário já mapeia `explore`, `quick` e `docs` para `claude-haiku`, e `ultrabrain` para `claude-opus`. Essas categorias são exatamente os papéis de executor.
- **Papéis de plano** (`roleCombos`: `planHead`, `milestone`, `checker`, `reviewer`, `src/core/routing/model.ts:169-175`) e "Opus planeja, Sonnet constrói, Haiku explora" (`src/core/routing/presets.ts:10-28`, aplicado no arranque desde `c392bd4a`).
- **Planos que um modelo menor executa** (`roadmap/planos-para-modelos-baratos.md`, `772762ff`): o contrato de tarefa (`verify`, `outOfScope`, `stopIf`) serve de base para o formato de resposta do executor.
- **A tela de combos** (`packages/mac/src/dialogs/CombosSettings.tsx`, com "By how hard", "By kind of work" e "By role"): o modo orquestrador entra como mais uma seção dela, não como tela nova.
- **Compactador** do Beluga (`src/core/compactor.ts`): manda `/compact` entre turnos e passa `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` ao Claude Code.
- **Pasta do bot com `.claude/agents/*.md`**, carregada pelo plugin-sombra (`skill-plugins.ts`).
- **Ferramentas do Beluga** (`mcp__beluga_mac__*`), o gate `canUseTool`/`PreToolUse` e o evento `sub`, que já desenha sub-agentes no Mac e no celular.

## 2. Como fica para o usuário

**Settings › Agent › Combos › Modo orquestrador**, uma seção nova na tela que já tem os mapas por dificuldade, tipo e papel:

| Campo | O que | Padrão |
|---|---|---|
| Ligado | Liga o modo nas conversas novas | desligado (proposto: ligar no onboarding) |
| Quem pensa | um combo (`claude-opus`, `strong`…) | o seu agente |
| Executores | uma linha por papel, cada um com combo e o que pode fazer | `explore` → Haiku (ler), `test` → Haiku (ler e rodar), `docs` → Haiku (ler) |
| Quando delegar | `sugerir` (o principal decide) ou `sempre` (buscas amplas e testes nunca no principal) | sugerir |
| Compactar em | tokens, não % (ver fase 1) | 160k |
| Orçamento | tokens por conversa e por dia, e o que fazer ao chegar perto | sem limite (avisa em 80% do plano de 5h) |

O mesmo bloco pode ficar mais específico, e o mais específico vence: **projeto** (`beluga.json` →
`orchestrator`), **bot** (`bot.json` → `orchestrator`) e **conversa** (`/orquestrador on|off`, ou o
menu ••• do chat). Um ícone no cabeçalho da conversa mostra "Opus pensa · 3 executores".

O formato, igual nos três lugares:

```json
"orchestrator": {
  "on": true,
  "lead": "claude-opus",
  "executors": {
    "explore": { "combo": "claude-haiku", "can": "read" },
    "test":    { "combo": "claude-haiku", "can": "run" },
    "local":   { "combo": "local-first",  "can": "read" }
  },
  "delegate": "suggest",
  "compactAt": 160000,
  "budget": { "conversation": 2000000, "day": 15000000, "near": "downgrade" }
}
```

- `can`: `read` (Glob, Grep, Read e as ferramentas de leitura do Beluga), `run` (também Bash, para typecheck e testes, sem Edit/Write) ou `edit` (só quando o usuário escolhe, como o "edita" do `/modo-orquestrador` no Claude Code).
- Um executor sem `combo` usa a categoria de mesmo nome em `categoryCombos`. Assim quem já mapeou `explore → claude-haiku` não configura nada de novo.

## 3. Fases

### Fase 0: parar de estourar já (só configuração)

Sem código. Na tela atual:

1. Settings › Agent › **Auto-compact: ligar**, limiar em 70% (o menor permitido hoje).
2. **Parallel runs** de 10 para 3 ou 4.
3. **Auto-continue** desligado nos chats longos (ou no geral até a fase 4).
4. Nos combos, Haiku nas categorias `explore`, `quick` e `docs` (já está assim).
5. **Índices do Stack em dia** no erp-rewrite: `gitnexus analyze --index-only` e `gls graphify build`. Conferir com `gls index --check`.
6. **Instalar o Ollama** (no Windows, o WSL o alcança): sem ele os alvos locais do combo Economy nunca rodam e o OpenViking fica sem embeddings.

Resolve "não compacta" na hora. Não resolve "compacta tarde demais" com janela de 1M: isso é a fase 1.

### Fase 0b: o Beluga confere o Stack em cada projeto (checklist)

Hoje o Stack (`src/core/stack/`) só confere se as ferramentas estão **instaladas** e se os serviços
**respondem**, e prepara o projeto **uma vez** (`stack.setupProject`). Nada confere se elas
**funcionam naquele projeto** nem se chegam aos **sub-agentes**. Por isso o erp-rewrite tem o
GitNexus velho e o graphify sem índice sem que nada tenha avisado.

O checklist roda ao abrir um projeto, depois de um merge, ao criar um worktree, uma vez por dia e no
botão **Conferir o Stack** (••• do projeto e Settings › Stack). Cada item diz ✓, ⚠ ou ✗, o que
fica sem funcionar e como corrigir.

**No computador** (uma vez, vale para todos os projetos):

| # | Item | Como confere | Correção |
|---|---|---|---|
| 1 | Ferramentas instaladas (RTK, token-goat, GitNexus, graphify, gls, hooktop) | o que o Stack já faz (PATH de login e pastas conhecidas) | diz como instalar (já existe) |
| 2 | Serviços no ar (OpenViking, Ollama, hooktop) | o que o Stack já faz | liga uma vez por queda (já existe) |
| 3 | **Ollama exigido quando é usado** | um combo tem alvo `local`, ou o OpenViking usa embeddings locais | Needs You dizendo o que fica sem funcionar (combo Economy sem alvos locais, busca do OpenViking sem embeddings) |
| 4 | **Hook do RTK** | `~/.claude/settings.json` tem `PreToolUse Bash → rtk hook claude` | botão: `rtk init` (com o seu sim) |
| 5 | **Hooks do GitNexus** | `PreToolUse Grep\|Glob\|Bash` e `PostToolUse Bash` apontam para um `gitnexus-hook.cjs` que existe | botão: reinstala os hooks do GitNexus |
| 6 | **MCPs do Stack registrados** | `gitnexus` e `openviking` no escopo do usuário, e cada um responde a `tools/list` | botão: registra de novo; mostra o erro do servidor quando não responde |
| 7 | **Regras do Stack no CLAUDE.md global** | o bloco `## Stack` e o do token-goat estão no `~/.claude/CLAUDE.md` (e `@RTK.md` resolve) | botão: acrescenta o bloco que falta (com cópia de segurança); nunca reescreve o que você mudou |

**Em cada projeto** (e em cada worktree, que tem índice próprio):

| # | Item | Como confere | Correção |
|---|---|---|---|
| 8 | **GitNexus indexado e em dia** | `gls index --check`: índice existe e está no HEAD | refaz em segundo plano: `gitnexus analyze --index-only` |
| 9 | **graphify construído** | `gls index --check` | `gls graphify build` (a primeira vez), depois `gls graphify ensure` |
| 10 | **Mapa do token-goat** | `gls index --check` | o próprio token-goat refaz; só avisa se falhar |
| 11 | Pastas dos índices fora do git | `.gitnexus/`, `.graphify-out/` e `.graph_loop_run` em `.git/info/exclude` | acrescenta (o setup já faz; aqui só confere) |
| 12 | `beluga.json` com o setup do Stack | o `setup` inclui `gitnexus analyze --index-only` e `gls graphify ensure`, para cada worktree novo se indexar | propõe a linha que falta; nunca sobrescreve um `beluga.json` seu |
| 13 | **Docs no OpenViking** | `viking://resources/<projeto>` existe e é mais novo que o último commit em `docs/`, `roadmap/` ou `README*` | reenvia só a documentação (o setup já faz isso) |
| 14 | Worktrees arquivados fora do registro do GitNexus | nenhum caminho do registro aponta para pasta que não existe | `gitnexus remove <pasta>` (já é feito ao arquivar; aqui limpa o que sobrou) |

**Nos sub-agentes** (o ponto que mais falha sem ninguém ver):

| # | Item | Como confere | Correção |
|---|---|---|---|
| 15 | **Ferramentas de cada sub-agente** | para cada `.claude/agents/*.md` (do usuário, do projeto e de cada bot): se o frontmatter tem `tools:`, a lista precisa incluir `Bash` (para RTK, token-goat, `gls` e o CLI do GitNexus) ou os MCPs do Stack (`mcp__gitnexus__*`, `mcp__openviking__*`). Sem `tools:`, o sub-agente herda tudo | mostra o que falta por agente; botão acrescenta `mcp__gitnexus__*` ao `tools:` (com o seu sim). Exemplo real: o `executor` deste repositório tem `tools: Bash, Glob, Grep, Read`, então usa o GitNexus só pelo CLI, sem `impact` nem `detect_changes` do MCP |
| 16 | **Modelo de cada sub-agente** | o `model:` do frontmatter. Sem `model:` (e sem `CLAUDE_CODE_SUBAGENT_MODEL`), o sub-agente herda o modelo principal | aviso quando um agente de leitura (explore, executor, tester) herda Opus; botão define `model: haiku` |
| 17 | **Hooks também nos sub-agentes** | numa execução de teste curta, um sub-agente roda um `git status` e o hooktop (ou o evento `sub`) mostra que o hook do RTK e o do GitNexus dispararam para ele | se não dispararam, o item diz qual hook e em que versão do Claude Code |
| 18 | **Regras do Stack nos sub-agentes** | a verificar: se o sub-agente recebe o CLAUDE.md global. Se não receber, as regras precisam ir no `prompt` dele | o Beluga injeta as regras no `prompt` dos executores que ele mesmo define (fase 2b) e sugere um parágrafo para os `.md` do usuário |
| 19 | **Sub-agentes de outros runtimes** | Codex lê `AGENTS.md` e `~/.codex/config.toml` (`mcp_servers`), OpenCode tem a própria configuração. Os hooks e o CLAUDE.md do Claude não chegam a eles | por runtime: confere se os MCPs do Stack estão na configuração dele e se há um `AGENTS.md` com as regras; diz o que falta (a verificar: suporte do RTK fora do Claude Code) |

Como aparece:

- **Settings › Stack**: a lista do computador e, por projeto, a do projeto e a dos sub-agentes, com ✓ ⚠ ✗ e um botão **Corrigir** por item que tem correção.
- **Corrige sozinho só o que é do projeto e não muda nada seu**: índices (8–10), exclusões (11), docs no OpenViking (13), registro do GitNexus (14). O que mexe em arquivo seu (`~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `.claude/agents/*.md`, `beluga.json`) só com o seu sim, sempre com cópia de segurança.
- **Needs You `stack`** (já existe e já chega ao celular): só para o que não se corrigiu sozinho, agrupado por projeto. O celular mostra, não corrige.
- **Medida**: cada checagem registra no blackbox o resultado e o tempo. Os índices são refeitos fora da fila das execuções, para não atrasar um agente.

Onde fica no código:

- `src/core/stack/checklist.ts` (novo, sem UI): os 19 itens como funções puras sobre o `StackDeps` que o `probe.ts` já usa, para os testes simularem o computador.
- `src/core/stack/monitor.ts`: quando rodar (abrir projeto, merge, worktree novo, diário).
- `src/core/stack/agents.ts` (novo): lê e corrige o frontmatter dos `.claude/agents/*.md` (`tools:` e `model:`).
- API: `stack.checklist(projectId?)` e `stack.fix(itemId, projectId?)`. Em `src/companion/coverage.ts`, `stack.checklist` é `phone` (só leitura) e `stack.fix` é `mac`.
- `docs/stack.md` ganha a seção "Checklist"; `docs/parity.md`, o botão e a lista.

Teste: um projeto com índice velho é refeito sem Needs You; um `.claude/agents/x.md` com `tools: Read` aparece como "sem Stack" e o Corrigir acrescenta `mcp__gitnexus__*` só depois do sim; sem Ollama e com um combo `local`, sai um item que diz o que fica sem funcionar.

### Fase 1: compactação que funciona (prioridade)

- **Limiar em tokens**: `autoCompactAt` aceita `{ "tokens": 160000 }` além da %. O que vier primeiro dispara. Padrão: 160k para janela de 1M, 85% para 200k. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` é calculado a partir do limiar em tokens e da janela do modelo da execução (`src/shared/context-usage.ts`, `compactor.ts:69-72`).
- **Ligado por padrão de novo**, desta vez como escolha: um card de Needs You, uma vez só ("O Beluga compacta conversas longas para não gastar o seu plano. Ligar?"), que grava `autoCompactChosen`. A migração de `settings.ts:29-35` continua respeitando quem desligou.
- **Todos os caminhos**: conferir e cobrir com teste que bots (`bot:<id>`), sentinels, planos (`src/core/plans/watchdog.ts`) e threads (`src/core/threads/launch.ts`) passam pelo `Compactor` e recebem o limiar. Hoje só o `run` do agent-host o passa (`agent-host.ts:1585`).
- **Sem número, sem compactação**: quando a execução não manda o evento `context`, o `due()` nunca dispara. Estimar pelo `usage` do último turno (`input + cache_read + cache_creation`) e registrar no blackbox quando faltar.
- **Laço do `tried`**: se o resumo ainda passar do limiar, avisar no chat ("O resumo continua grande: comece uma conversa nova a partir dele?") em vez de ficar em silêncio.
- Telas: o medidor de contexto mostra o limiar em tokens; o celular (`src/companion/views.ts`) recebe o mesmo número.

Teste: uma conversa com janela de 1M e 170k usados compacta antes do próximo turno, em projeto, bot e sentinel.

### Fase 2: executores Claude dentro da conversa (o núcleo)

Para o runtime Claude, sem MCP novo: o SDK já aceita sub-agentes com modelo próprio.

- `src/core/routing/orchestrator.ts` (novo, sem UI): resolve o bloco `orchestrator` (Settings → projeto → bot → conversa) em `{ lead, executors[] }`, cada executor com runtime e modelo resolvidos pelo combo (o primeiro alvo que pode rodar agora, como `routePlace`).
- `runner.ts`: com o modo ligado, passa `agents` ao SDK, um por executor Claude: `{ description, prompt, tools, model, maxTurns }`. O `prompt` é curto e fixo por papel (buscar e resumir; rodar e diagnosticar), `tools` vem de `can`. Passa também `CLAUDE_CODE_SUBAGENT_MODEL` com o modelo do executor `explore`, para que os sub-agentes embutidos (Explore, general-purpose) não herdem o Opus.
- `run-instructions.ts`: o brief do principal ganha um parágrafo ("Você é o orquestrador. Delegue a `explore` buscas que varrem muitos arquivos…"), com o mesmo texto que funciona no `/modo-orquestrador` do Claude Code. Com `delegate: "always"`, o gate `PreToolUse` recusa ao principal um Grep/Glob amplo e um `npm test` e sugere o executor.
- O `lead` escolhe o modelo da conversa como um combo já faz. Nada muda em quem não liga o modo.
- **Bots**: `bot.json` ganha `orchestrator`. O `.claude/agents/*.md` de um bot continua valendo e vence um executor de mesmo nome.
- Telas: o evento `sub` já desenha o sub-agente. Falta mostrar o modelo dele ("explore · Haiku") no Mac e no celular, e o Usage separar `lead` de `executor`.

Teste: com o modo ligado, a execução recebe `agents.explore.model = 'haiku'` e o env `CLAUDE_CODE_SUBAGENT_MODEL`. Com o modo desligado, as opções do SDK não mudam (snapshot das opções).

### Fase 2b: o Stack trabalhando com os executores

O Stack (`docs/stack.md`) já está instalado, mas é carregado inteiro em toda execução e usado pouco.
A ideia é inverter isso: quem lê (os executores) recebe as ferramentas de leitura econômica, e o
principal recebe só o que precisa para decidir.

- **Medir antes**: o evento `context` já traz `breakdown` (conversa, ferramentas…). Registrar no Usage quanto dos 53k de base vem de regras, ferramentas e MCPs, por conversa, para saber o que cortar.
- **Cada executor com o seu Stack**: a `AgentDefinition` do SDK aceita `mcpServers` e `tools` por agente. `explore` recebe o MCP `gitnexus` e os comandos `token-goat` e `gls symbol`; `docs` recebe o `openviking`; `test` recebe `gls gate`. O principal fica com o `gitnexus` (para `impact` antes de editar) e sem o resto.
- **Regras do Stack onde são usadas**: hoje elas ficam no `~/.claude/CLAUDE.md` global e entram em todo turno de todo modelo. Settings › Stack ganha "Regras do Stack: no CLAUDE.md global | só nos executores". Na segunda opção o Beluga passa as regras no `prompt` de cada executor e, com um sim seu, tira o bloco do CLAUDE.md global (com cópia de segurança). O Beluga continua sem escrever nada nos projetos.
- **token-goat com hook, não só com regra**: o gate `PreToolUse` que o Beluga já tem (`runner.ts:231-268`) recusa a um executor o `Read` de um arquivo grande inteiro e sugere `token-goat` ou `gls symbol`. Com `delegate: "always"`, faz o mesmo no principal e sugere o `explore`.
- Índices em dia, Ollama, hooks e o Stack dos sub-agentes do usuário: ver o checklist da fase 0b. Aqui fica só o que vale para os executores que o Beluga define.
- **OpenViking como memória da compactação**: depois de um `/compact`, o resumo vai para `viking://resources/<projeto>/conversas/<id>`. O "Continue where you left off" e uma conversa nova sobre o mesmo assunto buscam ali, em vez de carregar o histórico inteiro.
- **Ver a economia**: Settings › Stack mostra quanto cada ferramenta poupou (`rtk gain`, `token-goat stats`, `gls usage savings`) ao lado do gasto do Usage, para saber se vale a pena.

Teste: com o modo ligado, `agents.explore.mcpServers` tem o `gitnexus` e o principal não tem o `openviking`; um `Read` de 3.000 linhas num executor é recusado com a dica do token-goat; um índice velho é refeito sem item de Needs You.

### Fase 3: executores de outros modelos (Codex, local, OpenCode)

Outros provedores (GLM, Kimi, DeepSeek, Gemini…) chegam pelo 9router como endpoint: plano próprio em
[9router.md](9router.md), inclusive a correção de privacidade que precisa vir antes.

Para "trabalhar com vários modelos diferentes", o executor precisa poder ser qualquer runtime.

- Ferramenta nova `mcp__beluga_mac__delegate({ executor, task, paths? })`, **síncrona**: abre uma execução curta no combo do executor, na mesma pasta, só com o que o `can` permite (leitura: `askOnly`, como a pergunta de um amigo, `agent-host.ts:1391-1397`), com teto de turnos, tempo e tokens. Devolve só o resumo final.
- Aparece na conversa como sub-agente (evento `sub` com `runtime` e `model`) e conta no Usage do alvo em que rodou ("explore · Ollama qwen").
- Só nas suas próprias execuções, nunca na de um amigo ou agente externo abaixo de `full`.
- `delegate` é escolhido pelo principal quando o executor não é Claude. Quando é Claude, a fase 2 já cobre, mais barata (sem processo novo).
- Kept in step: a ferramenta não é método de API, então `coverage.ts` não muda. Se a tela ganhar "Executores" no ••• da conversa, o método novo é classificado `mac`.

Teste: `delegate` num combo `local-first` com Ollama falso devolve o resumo, roda sem Edit/Write e é recusado numa execução de amigo.

### Fase 4: orçamento e gasto consciente

- **Orçamento** por conversa e por dia (tokens; o custo em US$ só como informação). Ao chegar em `near`: `downgrade` (o principal passa do Opus para o Sonnet e os executores para local), `ask` (Needs You com as opções, e notifica o celular) ou `stop`.
- **Plano de 5h**: o Beluga já lê `five_hour` e `seven_day` (`src/agent/runtime/claude/usage.ts:43-56`). Acima de 80%: avisar e aplicar `near`. Acima de 95%: novas execuções vão para o próximo alvo do combo antes de bater no limite, não depois.
- **Auto-continue** respeita o orçamento: não volta a rodar sozinho uma conversa que passou do orçamento do dia.
- **`parallelRuns`** passa a 4 por padrão para quem não escolheu.
- O pedido "Continue where you left off" depois do reset vai com o modo orquestrador, não com o contexto inteiro: compacta antes de continuar.

### Fase 5: medir

- Usage por papel (principal × executores) e por conversa; "tokens poupados" estimados (tokens dos executores × diferença de preço).
- Relatório semanal em Needs You: as 5 conversas que mais gastaram e por quê (sem compactar, muitas leituras no principal, auto-continue).

## 4. Regras do repositório (CLAUDE.md)

- Métodos novos (`settings.orchestrator.*`, se houver) em `src/companion/coverage.ts`: `mac` (é configuração).
- O celular **mostra** o modo (cabeçalho e sub-agentes com o modelo, em `src/companion/views.ts` e `packages/companion/app/`), mas não o configura.
- `docs/parity.md` com a tela nova e o comando `/orquestrador`; `docs/routing.md` e `docs/bots.md` com o campo `orchestrator`.
- `src/core/routing/orchestrator.ts` fica sem UI (`tests/boundaries.test.ts`).
- Fase 2b: os itens novos do Stack (índice velho que falhou, Ollama faltando) usam o Needs You `stack` que já existe, então o celular os mostra sem card novo. As opções de Settings › Stack são `mac`. `docs/stack.md` ganha as seções novas.
- `src/protocol.ts`: o evento `sub` ganha `runtime?` e `model?`, só como acréscimo.

## 5. Riscos

| Risco | Mitigação |
|---|---|
| O principal delega demais e perde contexto | `delegate: "suggest"` por padrão; o resumo do executor sempre cita arquivo:linha, e o brief manda conferir o trecho crítico antes de editar |
| Executor barato erra e o principal confia | prompt do executor pede "não confirmado" explícito; o principal confere antes de editar |
| `CLAUDE_CODE_SUBAGENT_MODEL` muda o comportamento de quem não liga o modo | só é passado com o modo ligado |
| `delegate` vira caminho para fugir do gate | roda com o `can` do executor, nunca acima do nível de quem pediu; só execuções suas |
| Compactar cedo demais perde detalhe | 160k é ajustável; `COMPACT_INSTRUCTIONS` mantém decisões, arquivos tocados e pendências |

## 6. Ordem sugerida

F0 (hoje, só configuração) → **F0b** (o checklist do Stack: sem ele as fases seguintes rodam sobre
índices velhos e sub-agentes sem ferramentas) → **F1** (compactação: maior economia, pouco risco) →
**F2** (executores Claude) → **F2b** (o Stack nos executores) → F4 (orçamento) → F3 (outros
runtimes) → F5. F1 e F2 dão a maior parte da economia, e F0b e F2b fazem os executores lerem pouco. F3 é a que realiza o "vários
modelos diferentes", e vem depois porque precisa do gate de leitura testado.

## 7. Situação e decisões (registro)

- **2026-11-15**: plano criado. Medido no motor do WSL: `autoCompact: false`, `parallelRuns: 10`,
  `autoContinue: true`, `subagents` só afeta a exibição, nenhum `agents` passado ao SDK. Os Haiku
  `explorador` e `testador` de hoje são do usuário (`~/.claude/agents/`), fora do controle do Beluga.
- **2026-11-15**: acrescentada a fase 2b (o Stack nos executores). Medido: RTK 1,3M tokens poupados
  (21,9%), token-goat 2M em 30 dias (425 usos), `gls usage savings` vazio, GitNexus velho e graphify
  sem índice no erp-rewrite, Ollama ausente, 53k de contexto num "oi" à Clara.
- **2026-11-15**: acrescentada a fase 0b, o checklist do Stack em 19 itens (computador, projeto e
  sub-agentes). O que é só do projeto se corrige sozinho; o que mexe em arquivo do usuário pede sim.
  A verificar antes de implementar: se os sub-agentes do Claude Code recebem o CLAUDE.md global e se
  os hooks disparam nas chamadas deles (item 17 confere na prática).
- **2026-11-15, F0 aplicada no motor do WSL e no erp-rewrite**:
  - Beluga: `autoCompact: true` (escolhido), limiar 70%, `parallelRuns: 4`, `autoContinue: false`
    (cópia em `~/.beluga/settings.json.bak-20261115-124334`).
  - `~/.claude/settings.json` (cópia ao lado, mesmo sufixo): `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`,
    que o Claude Code 2.1.246 aceita (janela de auto-compactação em tokens, limitada à do modelo). Com os
    70% do Beluga, compacta perto de 140k em vez de 700k: adianta a fase 1 sem código. E
    `env.CLAUDE_CODE_SUBAGENT_MODEL=haiku`: nenhum sub-agente herda o modelo principal.
  - erp-rewrite: GitNexus reindexado (3.651 nós, em dia); `.graph_loop_memory.db` e `.claude/worktrees/`
    no `.git/info/exclude`; seção "Modo orquestrador" no `CLAUDE.md` (sem commit no repo do ERP). O
    `gls graphify build` já rodava em outro terminal.
  - Ollama: já roda no Windows, e o WSL o alcança em `127.0.0.1:11434` (`networkingMode=mirrored`).
    O Beluga o tem como endpoint embutido `ollama`; o OpenViking está no ar com embeddings
    `qwen3-embedding:0.6b` e VLM `gemma3:4b`. Para agente local só o `qwen3:8b` tem `tools`. O
    "Ollama ausente" medido antes era falso: a checagem procurava o binário no WSL.
  - Teste ao vivo (`ws:chat-c6027430`): o Sonnet delegou a busca ao `explorador` (Haiku) e não leu
    nenhum arquivo de código ele mesmo.
- **2026-11-15, bug achado no teste**: o CLAUDE.md/AGENTS.md do projeto **nunca chegava** às execuções
  Claude. O SDK só carrega o CLAUDE.md com `settingSources: ['project']`, e o Beluga carrega só `user`
  (de propósito: hooks plantados). Corrigido em `src/agent/project-instructions.ts`, que acrescenta o
  texto (com os `@imports`, dentro da pasta, nunca arquivo secreto) às instruções da execução; bots
  ficam de fora porque a persona já vai no brief. Isso responde à dúvida do item 18: as regras do
  projeto não chegavam nem ao principal.
- **2026-11-15, F3 implementada** (`mcp__beluga_mac__delegate`): um executor cujo combo roda fora do
  Claude vira "delegado". Cada chamada é o `complete` do runtime (um processo, fechado ao responder),
  5 min, 400k tokens, 30 turnos; cai para o próximo alvo do combo quando um não pode rodar (sem login,
  limite, endpoint fora, ou falhou sem gastar token) e diz quem respondeu. Portão = `can` da F2, nunca
  acima do lugar do principal; o Codex roda no sandbox só-leitura. Aparece como "delegate · Codex ·
  explore" e o uso conta como executor (relatório `delegated`, somado como está). Só com principal
  Claude por enquanto. Falta testar ao vivo com Codex e Ollama de verdade.
- **Aberto**: ligar o modo por padrão no onboarding ou só por escolha; valor de `compactAt` (160k é
  um palpite, medir na fase 5); se `delegate: "always"` deve recusar ferramentas no principal ou só avisar.
