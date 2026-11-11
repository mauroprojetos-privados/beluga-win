# Roteamento inteligente de agentes e modelos no Beluga

> Objetivo: com o tempo, usar vários agentes (Claude, Codex, OpenCode, Copilot, modelos locais) e
> vários LLMs, escolhendo para cada tarefa o mais barato que dá conta, e trocando sozinho quando um
> acaba a cota ou falha. É a ideia do 9router (combos com fallback), mas no nível da **tarefa**, que
> é onde o Beluga tem contexto que um proxy não tem.

Status: fases 1 a 5 feitas · fases 6, 6b, 6c e 7 propostas · atualizado em 2026-11-11

## 1. O que o Beluga já tem (não reinventar)

| Peça | Onde | O que faz hoje |
|---|---|---|
| Vários runtimes | `src/agent/runtime/{claude,codex,opencode,copilot}` | cada conversa ou worktree roda no agente escolhido |
| Endpoints próprios | `src/agent/runtime/local.ts`, Settings › Claude › Local models | Claude Code apontado para qualquer endereço compatível com Anthropic (`ANTHROPIC_BASE_URL`): Ollama, LiteLLM, Magpie… |
| Escolha de modelo | `AgentHost.modelFor` (`src/core/agent-host.ts:1689`) | conversa › agente da tarefa/projeto › Settings › padrão do Claude Code |
| Agente por tarefa | `board.create` (Agent pop-up), `board.start` (Start with ▸) | modelo fixado por tarefa ou só para uma execução |
| Chamadas laterais com fallback | `routeSideCall` (`src/agent/runtime/router.ts`) | nomes, rascunhos, setup: runtime padrão, senão Claude |
| Troca no meio da conversa | `/handoff`, `workbench.setAgent` | leva a conversa para outro agente |
| Limite de uso | `src/core/auto-continue.ts` | detecta "acabou a cota" e retoma quando o limite volta |
| Uso por agente | Usage (`stats.get`, `hasUsage`) | tokens, janelas do plano, por projeto e por agente |
| Planos | `docs/tasks-and-plans.md` | agente principal, um agente por etapa, verificador separado |

Falta só a **decisão automática**: hoje um humano escolhe o modelo, e quando a cota acaba a tarefa
espera o limite voltar em vez de passar para outro agente.

## 2. Divisão de papéis: Beluga × gateway

Não vale construir um 9router dentro do Beluga. Cada um faz o que enxerga melhor:

| Camada | Quem | Decide |
|---|---|---|
| **Por tarefa** | Beluga | qual agente e modelo para *esta tarefa / etapa / papel*, e para onde ir quando acaba a cota |
| **Por requisição** | gateway (Magpie, 9router, LiteLLM) | repetir uma chamada que falhou, girar chaves, cair para o provedor reserva do mesmo nível |

O gateway entra no Beluga como um **endpoint** (o que já existe). O Beluga passa a escolher entre
endpoints e runtimes.

> Cuidado: usar a **assinatura** do Claude Code ou do Codex por trás de um proxy compartilhado pode
> violar os termos do provedor. No Beluga, a assinatura fica com o próprio runtime (como hoje). O
> gateway fica para chaves de API e provedores que permitem isso.

## 3. Fases

### Fase 0: sem código (já dá para fazer)

- Settings: padrão `opusplan` ou Sonnet, com esforço *medium*.
- Sub-agentes Haiku em `~/.claude/agents/` (explorador, testador, documentador), já criados no WSL.
- Magpie ou 9router como endpoint em Settings › Claude › Local models › Add Endpoint, para os
  modelos baratos (GLM, MiniMax, Qwen, DeepSeek) e o Ollama local.
- Na hora de iniciar, escolher o modelo à mão em **Start with ▸**.
- Anotar por algumas semanas quais tipos de tarefa cada modelo resolve bem: é o dado que as fases 2
  e 5 vão usar.

### Fase 1: Combos (cadeias de fallback)

Um **combo** é uma lista ordenada de alvos com nome:

```ts
// src/core/routing/model.ts (novo)
interface RouteTarget { runtime: RuntimeId; model?: string; effort?: Effort; endpoint?: string }
interface Combo {
  id: string;
  name: string;              // "Econômico", "Forte", "Local primeiro"
  targets: RouteTarget[];    // em ordem; o primeiro disponível ganha
  privacy?: 'any' | 'no-third-party' | 'local-only';
}
```

- Fica nas prefs (`store.prefs.combos`), editado em **Settings › Agents › Combos**.
- `AgentRef` ganha `combo?: string`. Em `modelFor`, um combo vira o primeiro alvo **disponível**:
  runtime instalado e logado, endpoint respondendo, cota não esgotada.
- Exemplos de fábrica:
  - **Econômico:** Claude Sonnet → Codex → GLM (endpoint) → Ollama `qwen3-coder`
  - **Forte:** Claude Opus → Codex (alto esforço) → Claude Sonnet
  - **Local primeiro:** Ollama → endpoint barato → Claude Haiku
- O seletor (composer, New Task › Agent, Start with ▸) lista os combos acima dos modelos.

Arquivos: `src/core/agent-host.ts` (`modelFor`), `src/agent/types.ts` (`AgentRef`), o store de prefs,
`src/ipc/*-api.ts` (`routing.combos.*`), `packages/mac` (Settings e seletores).

### Fase 2: Fallback automático quando acaba a cota ou o agente falha

Hoje, `auto-continue.ts` espera o limite voltar. Com um combo:

1. A execução para em `limit` (ou o runtime está fora do ar, ou deu erro de autenticação).
2. O Beluga marca aquele alvo como **indisponível até** o horário em que o limite volta
   (`limitResumeAt`).
3. A tarefa segue no **próximo alvo** do combo por `/handoff`, que já leva a conversa junto, com uma
   nota no chat: *"Claude acabou a cota até 15:30; seguindo no Codex."*
4. Quando o alvo preferido volta, as tarefas **novas** usam ele de novo. As que estão rodando não
   trocam de agente no meio.
5. Combo inteiro esgotado: vira um item **NeedsYou** ("Todos os agentes do combo Econômico estão sem
   cota"), com as ações *Esperar* e *Escolher outro*. Notifica e aparece no celular.

Arquivos: `src/core/auto-continue.ts`, um novo `src/core/routing/availability.ts`, o caminho do
handoff, `src/companion/views.ts` e os cards do celular (novo tipo de NeedsYou).

### Fase 3: Classificar a tarefa na criação

O rascunho de tarefa (`src/agent/task-drafter.ts`, que já roda no Sonnet) passa a devolver também:

```ts
interface TaskProfile {
  kind: 'explore' | 'implement' | 'fix' | 'refactor' | 'test' | 'docs' | 'plan' | 'review';
  tier: 'simple' | 'normal' | 'hard';   // tamanho, risco, quantos arquivos toca
  why: string;                          // uma linha, mostrada na tarefa
}
```

- Uma tabela em Settings mapeia `tier` (e, se quiser, `kind`) para um combo. Por padrão:
  simple → Econômico, normal → padrão, hard → Forte.
- Além do nível, **categorias com nome de trabalho**, à moda do oh-my-hermes: `quick`, `deep`,
  `ultrabrain`, `visual`, `review`, `docs`. Elas mapeiam melhor do que só o nível: `visual` → Kimi,
  `ultrabrain` → Opus, `docs` → Haiku. Cada categoria aponta para um combo e um esforço, editáveis em
  Settings.
- A tarefa mostra *"Simples · Econômico"* com o motivo. Você muda com um clique, e essa troca é
  guardada como correção para a fase 5.
- Uma tarefa sem rascunho (criada à mão) recebe só uma classificação rápida com o Haiku
  (`routeSideCall`, como as outras chamadas laterais).

### Fase 4: Modelo por papel

Cada papel que o Beluga já tem ganha o seu combo, configurado em Settings › Agents › Papéis:

| Papel | Sugestão |
|---|---|
| Plano (agente principal) | Forte |
| Agente de etapa | o combo da classificação (fase 3) |
| Verificador de etapa | **outro fornecedor** que o autor (revisão cruzada: Codex verifica o Claude) |
| Revisor de PR (`pr-reviewer.ts`) | Econômico |
| Chamadas laterais | o mais barato (já é o Haiku) |
| Sentinels | Local primeiro |

### Fase 5: Medir e aprender

- Para cada execução, guardar: combo, alvo usado, `kind` e `tier`, tokens e custo, e se deu certo
  (a tarefa chegou a In Review sem retrabalho, as verificações passaram, o usuário não trocou de
  modelo).
- A tela de Usage ganha a seção **Roteamento**: custo por tipo de tarefa e por modelo, quanto se
  economizou em relação a "tudo no Opus", e com que frequência houve fallback.
- Sugestões, nunca mudanças automáticas: *"Tarefas `docs` no Econômico deram certo em 95% dos casos;
  usar Haiku direto?"*
- Bem depois, se os dados justificarem: um roteador aprendido a partir desse histórico.

### Fase 6: Bots (orquestradores permanentes na barra lateral)

Inspirado no app do oh-my-hermes: conversas fixas com nome, cada uma com um agente "chefe" que
conversa, planeja, delega e acompanha, **sem programar ele mesmo**. Quase tudo o que um bot faz o
Beluga já tem: Plans, worktrees, verificador, Needs You e Sentinels. O que é novo é o bot em si.

**O chat principal continua.** Os bots são uma camada a mais, não um substituto:

- **O Your Mac é o primeiro bot.** Ele ganha persona, combo e mapa de categorias opcionais, e passa a
  poder planejar e despachar. Assim não surge um lugar novo para conversar: quem não configura nada
  vê o Your Mac de sempre.
- **Os chats de projeto e as worktrees ficam como estão.** Para mexer você mesmo numa tarefa, você
  conversa com o agente dela direto, sem passar por bot nenhum.
- **Outros bots são opcionais:** só aparecem quando você cria um (um por projeto, um de pesquisa, um
  de deploy). Por baixo, cada um é o mesmo tipo de conversa que o Your Mac, com outra configuração.
- **Por isso a ordem de implementação é:**
  1. a configuração no próprio Your Mac (persona, combo, categorias, autonomia) e o painel do plano
     ao lado do chat dele;
  2. depois, "New Bot", que é só criar outra conversa desse mesmo tipo.

**Um bot é** (`src/core/bots/model.ts`, novo; o Your Mac é o bot `mac`, que já existe e não pode ser
apagado):

```ts
interface Bot {
  id: string;
  name: string; icon: string;           // "Kami"
  role: string;                         // instrução fixa: "orquestrador do web-app: planeja, divide, delega, revisa"
  projects: string[];                   // onde pode agir; vazio = como o Your Mac
  combo: string;                        // com que modelo ele pensa e conversa (ex.: Forte)
  categories: Record<Category, string>; // categoria → combo, para as tarefas que despacha
  autonomy: 'ask' | 'run-stop-on-fail' | 'autopilot'; // os modos que os planos já têm
  memory: string;                       // arquivo de notas do bot + "About This Project" de cada projeto
  triggers?: SentinelTrigger[];         // opcional: agir sozinho por agenda ou evento (Juno, deploy)
}
```

**O fluxo:**

1. **Criar:** o Your Mac já está lá; você o configura em Settings › Your Mac. Outros bots, em
   Settings › Bots › New Bot. Cada um aparece na barra lateral, na seção **Bots**, acima dos
   projetos, com o que está fazendo agora: *"2 de 6 prontas · esperando Contrast check"*.
2. **Conversar:** é uma conversa fixa, como um chat do Your Mac, com persona e memória. Para
   investigar, ele usa os sub-agentes Haiku (`explorador`, que usa token-goat e GitNexus), sem gastar
   o modelo caro do próprio bot.
3. **Planejar:** com o seu "vai", ele cria um **Plan** normal do Beluga. Cada tarefa recebe uma
   categoria (fase 3), e o **canvas do plano abre ao lado do chat**, onde dá para ajustar antes de
   executar.
4. **Despachar:** cada tarefa vira uma worktree com o agente escolhido por categoria → combo → alvo
   disponível (fases 1 e 3). O que não depende de nada roda em paralelo.
5. **Durante:**
   - quando acaba a cota, a tarefa segue no próximo alvo (fase 2) e o bot avisa no chat;
   - uma aprovação vira **Needs You** (no Mac e no celular), dizendo qual bot e qual tarefa pediu;
   - você pode mudar o plano conversando com ele.
6. **Verificar e entregar:** o verificador de cada etapa é de **outro fornecedor** (fase 4). Se
   reprovar, o bot cria as correções. No fim, ele faz o merge no branch do plano, abre o PR e posta
   um resumo com o custo e a economia (fase 5).
7. **Depois:** o bot continua na lateral com a memória do que fez. Vários bots convivem: um
   orquestra, outro pesquisa, outro cuida de deploy pelos gatilhos de Sentinel.

```
Você ──conversa──► Bot (persona + combo do bot + memória)
                      │ investiga via sub-agentes Haiku
                      │ cria
                      ▼
                    Plan (canvas ao lado do chat)
                      │ cada tarefa: categoria → combo → agente/modelo
                      ▼
        worktrees em paralelo (Claude · Codex · OpenCode/GLM/Kimi · Ollama)
                      │ cota acabou → próximo do combo
                      │ aprovação → Needs You (Mac + celular)
                      ▼
        verificador de outro fornecedor → correções → PR → resumo com custo
```

**Peças a construir:**

- Modelo e persistência dos bots: `bots.json` em `~/.beluga`, ao lado do `chats.json`. Os métodos
  `bots.*` em `src/ipc/*-api.ts` são classificados assim: ler e conversar é `phone`; criar e editar é
  `mac`.
- O agente do bot: as ferramentas de plano que o agente principal já tem (`plan_*`, `list_work`) e o
  prompt da persona. A escrita em código fica bloqueada pela política (`src/agent/policy.ts`): o bot
  só lê e delega.
- Interface no Mac:
  - a seção Bots na barra lateral, com a linha de estado;
  - o painel do plano ao lado do chat (a mesma visão do canvas, embutida);
  - Settings › Bots.
- Celular: os bots na lista de conversas, o estado de cada um e o Needs You com o nome do bot.
  Atualizar `src/companion/views.ts` e `packages/companion/app/`.
- Uma lane para o **omp** (oh-my-pi) como runtime novo, se valer a pena: hoje ele já está instalado
  no WSL.

**Depende de:** fases 1 a 3 (sem combos e categorias, o bot só despacharia para um modelo). A
fase 4 é desejável.

### Fase 6b: Bots especialistas (ferramentas, skills, conhecimento e memória por bot)

A ideia é um bot especializado numa ferramenta (Supabase, Expo, deploy, o próprio Beluga), com o
contexto, a documentação e as receitas dela. O Claude Code já carrega tudo o que define um
especialista **a partir da pasta em que roda**, e o Your Mac já roda numa pasta própria (`work/`).
Por isso, **um bot é uma pasta**:

```
~/.beluga/bots/supa/                  ← bot "Supa", especialista em Supabase
├── CLAUDE.md                         persona e regras: "você só cuida de Supabase: schema, RLS, migrations…"
├── .mcp.json                         ferramentas: o MCP do Supabase (e só ele)
├── .claude/
│   ├── skills/
│   │   ├── supabase-migrations/      como criar, testar e reverter migrations
│   │   └── supabase-rls/             padrões de RLS da casa, com exemplos
│   └── agents/                       sub-agentes do bot (ex.: "auditor-rls" no Haiku)
├── knowledge/                        a documentação: docs oficiais, ADRs, runbooks, erros já vistos
└── memory.md                         o que ele aprendeu nos trabalhos anteriores
```

**As quatro camadas:**

| Camada | Como funciona | Peça existente |
|---|---|---|
| Ferramentas | só os MCPs do bot são carregados (`.mcp.json` com `--strict-mcp-config`); menos ferramentas significa menos tokens por mensagem e menos chance de errar de ferramenta | `token-goat mcp-audit` mede o custo de cada MCP |
| Skills | receitas carregadas sob demanda: o modelo vê só o nome e a descrição até precisar delas | as skills do Claude Code, que o Beluga já lista no `/` (`claudeCode.skills`) |
| Conhecimento (RAG) | a documentação indexada e buscada **por trecho**, nunca colada inteira no contexto | o **OpenViking** no WSL: `viking://resources/<ferramenta>/…`, com níveis L0 (resumo), L1 (seção) e L2 (texto completo) |
| Memória | o que deu certo e errado nos trabalhos anteriores | `memory.md` do bot; graph-loop por repositório |

**Exemplos:**
- **Supa (Supabase):** MCP do Supabase, skills de migrations e RLS, docs do Supabase no OpenViking.
  *"Cria a tabela de convites com RLS por organização."*
- **Expo/Android:** skills de build e assinatura de APK, docs do Expo e do Gradle, o runbook do
  `npm run apk`. *"Por que o build de release falhou?"*
- **Deploy (Juno):** MCPs da VPS, do Docker e do Langfuse, o runbook de deploy, gatilhos de Sentinel.
  *"Sobe a 3.1 em staging."*
- **Beluga:** `docs/*.md` do repositório no OpenViking e skills como "adicionar um método de API"
  (coverage, parity, celular). Ele conhece as regras do `CLAUDE.md` sem reler tudo a cada vez.

**No fluxo:**
1. Você pede ao Your Mac: *"cria a tabela de convites no Triexis"*.
2. O Your Mac reconhece que é assunto de Supabase e **delega ao Supa**: a tarefa do plano recebe a
   categoria `supabase`, que aponta para o bot.
3. O Supa roda com as ferramentas dele, busca no OpenViking só os trechos que precisa, segue a skill
   de migrations e devolve a migration testada.
4. O que ele aprendeu vai para a memória dele.

Um especialista bem preparado pode rodar num modelo **barato** (Sonnet, GLM): o contexto certo vale
mais do que um modelo maior. A fase 5 vai medir isso.

**Peças a construir:**
- **Um bot é uma pasta** (`~/.beluga/bots/<id>/`). O agente do bot roda com `cwd` nela e
  `--add-dir` do projeto em que trabalha. Para o Your Mac, a pasta é a `work/` que ele já usa.
- **MCPs só do bot:** `--mcp-config <pasta>/.mcp.json --strict-mcp-config` no runtime Claude. Nos
  outros runtimes, o equivalente de cada um, ou o aviso de que não dá.
- Settings › Bots ganha as abas:
  - **Tools:** escolher MCPs entre os instalados, ou adicionar um;
  - **Skills:** criar, importar ou copiar de `~/.claude/skills`;
  - **Knowledge:** arrastar arquivos ou colar URLs. O Beluga indexa no OpenViking, mostra o que
    está indexado e permite reindexar;
  - **Memory:** ver, editar e limpar.
- **Categoria → bot:** no mapa de categorias, o destino pode ser um combo ou um bot
  (`supabase` → Supa).
- **Conhecimento como ferramenta:** o bot recebe uma ferramenta `knowledge_search` (o OpenViking por
  MCP, ou um MCP próprio do Beluga), limitada às pastas `viking://` dele.
- **Celular:** mostra que bot fez o quê e o estado de cada um. Conhecimento, skills e configuração
  ficam só no Mac (regra do `CLAUDE.md`). Os métodos novos são classificados assim:
  `bots.knowledge.*` e `bots.tools.*` → `mac`, e a leitura de estado → `phone`.
- **Segurança:**
  - os MCPs de um bot não vazam para outro;
  - os segredos dos MCPs ficam no `~/.beluga/env.json` (como os endpoints), nunca no `.mcp.json`
    nem no conhecimento;
  - `isSecretPath` vale para `knowledge/`.

**Depende de:** fase 6 (bots), mais o OpenViking configurado (`openviking-server init`, ainda
pendente no WSL).

### Fase 6c: Bot Studio (interface para construir cada bot, salvando em arquivos)

Princípio: **os arquivos são a fonte da verdade, e a interface é um editor deles.** O que você monta
na tela vira arquivo na pasta do bot, e o que é editado nos arquivos (por você ou por um agente)
aparece na tela. Assim dá para versionar, copiar, compartilhar e editar à mão.

**Os arquivos de um bot:**

```
~/.beluga/bots/supa/
├── bot.json            identidade e roteamento: nome, ícone, cor, combo, categorias, autonomia, runtime
├── CLAUDE.md           persona e regras (texto livre)
├── .mcp.json           ferramentas; segredos como ${env:SUPABASE_TOKEN}, nunca o valor
├── .claude/skills/…    uma pasta por skill (SKILL.md + arquivos de apoio)
├── .claude/agents/…    sub-agentes do bot
├── knowledge.json      fontes do conhecimento (arquivos, URLs, repositórios) + estado do índice
├── knowledge/          cópias locais das fontes
├── memory.md           memória editável
└── .git/               histórico: cada salvamento é um commit
```

O `bot.json` guarda só o que não tem lugar natural nos outros arquivos. O resto fica nos formatos do
próprio Claude Code, então a pasta funciona mesmo fora do Beluga. O formato do `bot.json` é um
schema zod (`src/core/bots/schema.ts`), com `version` para migrações.

**A interface** fica em Settings › Bots › (um bot):

```
┌ Supa ───────────────────────────────────────────── [Testar] [•••] ┐
│ Identidade │ Modelo │ Ferramentas │ Skills │ Conhecimento │ Memória │
├───────────────────────────────────────────────────────────────────┤
│ Ferramentas                                                        │
│  ☑ supabase      conectado · 18 ferramentas · ~2,1k tokens         │
│  ☐ github        instalado                                         │
│  ☐ postgres      instalado                                         │
│  [+ Adicionar MCP]   segredos: SUPABASE_TOKEN ✓ salvo no env.json  │
└──────────────────────────────── salvo em ~/.beluga/bots/supa ✓ ───┘
```

| Aba | O que tem | Arquivo |
|---|---|---|
| Identidade | nome, ícone, cor, persona (editor de texto com modelos prontos) | `bot.json`, `CLAUDE.md` |
| Modelo | combo do bot, mapa de categorias, autonomia | `bot.json` |
| Ferramentas | ligar e desligar os MCPs instalados, custo em tokens de cada um, adicionar um novo, segredos à parte | `.mcp.json`, `env.json` |
| Skills | listar, criar, editar e importar (das suas skills ou de outro bot); validação do cabeçalho | `.claude/skills/` |
| Conhecimento | arrastar arquivos, colar URLs ou um repositório; o que foi indexado e quando; reindexar; busca de teste | `knowledge.json`, `knowledge/`, OpenViking |
| Memória | ler, editar, limpar | `memory.md` |
| Testar | chat de teste sem tocar em projeto nenhum, mostrando quais ferramentas, skills e trechos de conhecimento ele usou | — |

**Três jeitos de criar um bot:**
1. **Do zero:** preencher as abas.
2. **De um modelo:** uma galeria com Supabase, Expo, Deploy e Revisor de PR, que você ajusta.
3. **"Criar com o Claude":** você descreve o bot e o Claude gera a primeira versão dos arquivos
   (persona, skills, MCPs sugeridos, fontes de documentação). Você **revisa o diff antes de
   salvar**: o mesmo padrão do redator de tarefas (`task-drafter.ts`).

**Detalhes:**
- **Ida e volta:** o Beluga observa a pasta (watcher), e uma edição externa atualiza a tela na hora.
  Se você editou a mesma coisa na tela e no arquivo ao mesmo tempo, ele avisa em vez de sobrescrever.
- **Histórico:** cada salvamento é um commit no `.git` do bot, com "Desfazer" e "Ver versões".
- **Validação:** um MCP que não conecta, uma skill com cabeçalho inválido ou um segredo faltando
  ficam marcados com o motivo, e o bot avisa antes de rodar.
- **Exportar e importar:** `.zip` ou repositório git **sem os segredos**. Na importação, ele pede os
  segredos que faltam.
- **Celular:** ver os bots, o estado e conversar. A edição fica no Mac. Os métodos `bots.edit.*`,
  `bots.export` e `bots.import` são `mac`; `bots.list` e `bots.status` são `phone`.
- **Parity:** cada aba e cada ação entram em `docs/parity.md`. O Bot Studio entra também no web
  (`beluga web`), que hoje é o jeito de usar o motor do WSL.

**Ordem dentro da fase:**
1. Identidade, Modelo e Ferramentas, mais o botão Testar.
2. Skills e Memória.
3. Conhecimento, que é a mais trabalhosa (indexação no OpenViking).
4. "Criar com o Claude" e a galeria de modelos.

**Depende de:** fases 6 e 6b.

### Fase 7: Vários idiomas, começando por português do Brasil

Hoje o Beluga só fala inglês: não há biblioteca de tradução. Os textos estão escritos direto nos
~440 componentes do Mac (`packages/mac/src`), nas ~35 telas do celular (`packages/companion/app`) e
em textos montados pelo daemon (avisos, Needs You, notificações, `src/companion/views.ts`). Datas e
números já usam o `Intl` do sistema, sem regra única: na suíte do Windows em pt-BR, alguns testes
falham por isso.

**O que muda para quem usa:**
- **Settings › General › Idioma:** *Automático (o do sistema)*, *English* ou *Português (Brasil)*.
  O celular segue o idioma do Mac, ou o próprio, se você escolher.
- **Toda a interface traduzida:** menus, botões, Settings, Needs You, notificações, a interface web
  e o celular.
- **Datas, horas, números e moeda no formato do idioma** (`11/11/2026 14:30`, `R$ 1.234,56`), num só
  lugar.
- **Os agentes falam o seu idioma:**
  - o prompt do agente ganha "responda em português do Brasil";
  - as chamadas laterais também: o nome da worktree, o rascunho da tarefa, a descrição do projeto, o
    resumo do plano e a revisão de PR;
  - os bots (fase 6) têm o idioma como campo do `bot.json`.
- **Os commits e os PRs** seguem uma regra **por projeto**, e não o idioma da interface: um
  repositório em inglês continua recebendo commits em inglês. Isso fica em Settings do projeto
  (*Idioma dos commits e PRs*).

**Como construir:**
1. **A base:** uma camada de tradução tipada e leve, que funcione no daemon, no Mac, no web e no
   celular. Por exemplo: `src/shared/i18n/` com `t('chat.send')`, catálogos
   `en.ts`/`pt-BR.ts`, plural com `Intl.PluralRules` e formatação com `Intl` num único
   `format.ts`. Precisa ser compatível com navegador (`tests/browser-safe.test.ts`) e sem
   dependências pesadas. A chave que falta no pt-BR cai para o inglês, nunca aparece vazia.
2. **Extrair os textos:** feito por partes, tela por tela, com um script que encontra texto solto nos
   `.tsx`. Um teste falha quando uma tela já migrada ganha texto sem `t()`.
3. **O daemon manda chave e parâmetros**, não frase pronta, para o que vai às telas (Needs You,
   avisos), e cada tela traduz. Quando isso não é possível (uma notificação do sistema, por
   exemplo), o daemon usa o idioma escolhido. No `src/companion/protocol.ts`, isso só pode ser
   aditivo: campos novos `key` e `params` ao lado do `text` atual, que continua para os celulares
   antigos.
4. **O pt-BR completo:** tradução revisada por uma pessoa, com glossário (worktree, plan, sentinel,
   Needs You: o que traduzir e o que manter).
5. **Os agentes:** o idioma entra no prompt (`src/agent/prompt.ts`) e nas chamadas laterais
   (`side-calls.ts`). O idioma dos commits e PRs vem da configuração do projeto.
6. **Os testes:**
   - as suítes passam a fixar o idioma (`LANG=en-US`), resolvendo de vez as falhas de formatação em
     máquinas pt-BR;
   - um teste confere que todas as chaves existem nos dois catálogos;
   - uma rodada de testes de interface em pt-BR verifica textos que estouram o espaço.
7. **A documentação:** `docs/` continua em inglês. Um guia de uso em pt-BR (`docs/guide`) vem
   depois, separado.

**Ordem:** a base e a formatação primeiro (resolvem os testes); depois as telas mais usadas
(barra lateral, chat, Needs You, Settings, celular); depois o resto; e o idioma dos agentes pode
vir logo no começo, porque é pequeno e já ajuda muito.

**Regras do `CLAUDE.md` que se aplicam:** os textos do celular e do Mac mudam juntos; o
`protocol.ts` só muda de forma aditiva; o `docs/parity.md` ganha a linha do idioma em Settings; e a
chave de idioma passa pelo `coverage.ts` (`settings.language` → `mac`; o celular tem o próprio
seletor).

**Depende de:** nada. Pode correr em paralelo com qualquer outra fase. Só o idioma dos bots depende
da fase 6.

## 4. Regras do repositório (CLAUDE.md)

- Todo método novo em `src/ipc/*-api.ts` precisa ser classificado em `src/companion/coverage.ts`:
  ver combos e o motivo do roteamento é `phone`; editar combos e papéis é `mac`.
- O celular mostra em cada tarefa o modelo e o combo usados, e o novo NeedsYou de "combo esgotado".
  Mudanças em `src/companion/protocol.ts` só aditivas.
- Atualizar `docs/parity.md` (Settings › Combos, Papéis, seletores) e escrever `docs/routing.md`.
- Testes: `modelFor` com combos, disponibilidade e fallback (fake de limite), classificação
  (fake do drafter) e o card do celular.

## 5. Riscos

- **Qualidade:** modelos baratos erram mais no uso de ferramentas. O combo só cai para um alvo que
  passou num teste rápido de ferramentas (ler arquivo, editar, rodar comando), feito uma vez por
  modelo e guardado.
- **Privacidade:** código indo para terceiros. Use `privacy` por combo e uma lista de projetos
  permitidos; projetos sensíveis ficam em `local-only`.
- **Troca de contexto:** o handoff resume a conversa, e algo se perde nisso. Por isso só se troca de
  agente entre tarefas ou quando a cota acaba, nunca a cada mensagem.
- **Termos de uso:** a assinatura fica sempre com o runtime oficial (ver seção 2).

## 6. Ordem sugerida

1. Fase 0 agora; anotar o que funcionou.
2. Fase 1 (combos) e fase 2 (fallback): a maior parte da economia e da robustez com pouco risco.
3. Fase 4 (papéis): pequena depois que os combos existirem.
4. Fase 3 (classificação): quando houver dados da fase 0 para calibrar os níveis.
5. Fase 5 (medição): começa a gravar já na fase 1; a tela vem depois.
6. Fase 6 (bots): por último, juntando tudo numa conversa por bot.
7. Fase 6b (bots especialistas): logo depois da 6. Dá para testar antes, à mão: uma pasta com
   `CLAUDE.md`, `.mcp.json` e skills, aberta como projeto no Beluga.
8. Fase 6c (Bot Studio): a interface que edita essas pastas. As abas de Identidade, Modelo e
   Ferramentas podem vir junto com a fase 6.
9. Fase 7 (idiomas, pt-BR): independente, pode correr em paralelo desde já. O idioma dos agentes e a
   formatação primeiro.

## 7. Exemplo prático (tudo pronto, fases 1 a 6)

> Os tempos e custos são ilustrativos.

**Cenário.** Segunda de manhã, projeto **Triexis**. O pedido é *"corrigir o botão de reconhecer que
não funciona, e adicionar exportar CSV na tela de relatórios"*.

O Your Mac está configurado como bot:
- **Persona:** "tech lead do Triexis";
- **Combo próprio:** Forte (Opus);
- **Categorias:** `quick` → Econômico (GLM ou Haiku), `deep` → Sonnet, `visual` → Kimi, `review` →
  Codex;
- **Autonomia:** perguntar antes de executar.

**1. O pedido (08:50).** No celular, para o Your Mac: *"O botão de reconhecer no Triexis não funciona.
E coloca exportar CSV nos relatórios. Abre PR no fim."*

**2. Investigação barata (08:51).** O Your Mac manda o sub-agente `explorador` (Haiku):
- `token-goat symbol reconhecer` → `RecognizeButton.tsx:42`, `useRecognize.ts:18`;
- `gitnexus impact useRecognize` → 3 telas usam o hook;
- `token-goat symbol ReportTable` → onde entra o CSV.

Ele responde: *"O botão chama `useRecognize`, que manda a requisição sem o `projectId` desde o commit
`a1b2c3`. São 4 partes: (1) corrigir o hook `deep`, (2) teste de regressão `quick`, (3) botão e
geração do CSV `visual`+`quick`, (4) revisão e PR `review`. Custo estimado: ~US$ 0,40 (tudo no Opus
seria ~US$ 2,10). Posso seguir?"*

**3. Aprovação e plano (08:53).** "Vai". O plano abre ao lado do chat:

```
[1 Corrigir useRecognize]──►[2 Teste do botão]──┐
   Sonnet · deep               Haiku · quick    ├──►[4 Revisão + PR]
[3 Exportar CSV]────────────────────────────────┘     Codex · review
   Kimi · visual
```

As tarefas 1 e 3 começam juntas, cada uma na sua worktree; a 2 espera a 1.

**4. Execução (09:20).**
- A tarefa 1 termina com Sonnet: 12 min, 1 commit.
- A tarefa 3 começa com Kimi e **a cota acaba**. O combo `visual` passa sozinho ao próximo da lista
  (Sonnet, fase 2), e o chat avisa: *"Kimi sem cota até 14:00; o CSV seguiu no Sonnet."*
- A tarefa 2 roda com Haiku. O sub-agente `testador` roda os testes pelo `rtk` e devolve: *"PASS
  48/48, novo teste cobre o caso sem projectId"*.

**5. Precisa de você (09:35).** O agente do CSV quer rodar `npm i papaparse`. Isso vira **Needs You**
no celular, *"Your Mac › Exportar CSV quer rodar `npm i papaparse`"*, com [Permitir] [Negar].

**6. Revisão por outro fornecedor (09:50).** O Codex confere o trabalho do Claude e reprova: *"o CSV
não escapa vírgulas dentro do texto"*. O Your Mac cria a correção (`quick`, Haiku, 3 min). O Codex
confere de novo e aprova.

**7. Entrega (10:00).** Merge no branch do plano, PR aberto, e o resumo no chat: *"PR #57: corrige o
reconhecimento (faltava `projectId`) e adiciona Exportar CSV. 4 tarefas + 1 correção · 1h07 ·
**US$ 0,46** (tudo no Opus ~US$ 2,30, economia de 80%) · 1 troca de modelo por cota (Kimi →
Sonnet)."* Você revisa o PR no celular e faz o Merge.

**Sem bot, no mesmo dia.** Para algo pequeno, como trocar "Reconhecer" por "Confirmar" no botão, você
abre o chat do projeto (ou uma worktree) e fala direto com o agente. Sem plano e sem despacho: o
Beluga de hoje.

**O que esse exemplo já tem hoje e o que falta:**

| Passo | Hoje | Falta |
|---|---|---|
| 2. Investigação com Haiku | ✅ sub-agentes no WSL | — |
| 3. Plano com tarefas e dependências | ✅ Plans, criados à mão | o plano ao lado do chat do Your Mac (fase 6) |
| Modelo por tarefa | ✅ à mão, em Start with ▸ | categoria → combo automático (fases 1 e 3) |
| 4. Troca quando a cota acaba | ❌ espera o limite voltar | fase 2 |
| 5. Needs You no celular | ✅ | o nome do bot no card (fase 6) |
| 6. Verificador por etapa | ✅ | o verificador de outro fornecedor automático (fase 4) |
| 7. Resumo com custo e economia | ❌ | fase 5 |

## 8. Situação e decisões (registro)

**Decisões tomadas:**
- O roteamento é **por tarefa, no Beluga**; o gateway (Magpie, 9router, LiteLLM) cuida de **cada
  requisição** e entra como endpoint.
- As assinaturas (Claude Code, Codex) ficam sempre com o **runtime oficial**, nunca atrás de um proxy.
- **O chat principal continua.** O Your Mac é o primeiro bot, com a configuração opcional; os chats
  de projeto e as worktrees seguem como estão.
- **Categorias de trabalho** à moda do oh-my-hermes (`quick`, `deep`, `ultrabrain`, `visual`,
  `review`, `docs`), cada uma apontando para um combo.
- **Um bot é uma pasta** (persona, MCPs, skills, conhecimento, memória), aproveitando o que o Claude
  Code já carrega pelo `cwd`. O conhecimento fica no OpenViking e é buscado por trecho.
- **Arquivos são a fonte da verdade; o Bot Studio é um editor deles**, com ida e volta, histórico em
  git e exportação sem segredos.
- **Não construir** um gateway próprio nem um roteador aprendido antes de ter os dados da fase 5.

**Situação em 2026-11-11:**

| Item | Estado |
|---|---|
| Fase 0: sub-agentes Haiku `explorador`, `testador` e `documentador` | ✅ em `~/.claude/agents/` no WSL; o `explorador` foi testado |
| Fase 0: padrão `opusplan` ou Sonnet em Settings | a fazer (você) |
| Fase 0: Magpie ou 9router como endpoint | o Magpie está rodando no WSL; faltam os provedores, a chave e o Add Endpoint |
| Fase 1: combos | ✅ feita: Settings › Agent › Combos (Economy, Strong, Local first), combos nos seletores, o combo e o alvo de cada execução; doc em `docs/routing.md` |
| Fase 2: troca quando acaba a cota | ✅ feita (`src/core/routing/failover.ts`): o próximo alvo continua a conversa, que é levada junto quando o runtime muda; com o combo esgotado, vira Needs You `combo` com Try Again, também no celular |
| Fase 3: classificar a tarefa | ✅ feita: o redator marca `simple` / `normal` / `hard` e também o tipo de trabalho (`quick`, `deep`, `ultrabrain`, `visual`, `review`, `docs`, `explore`) com o motivo; tarefa criada à mão recebe uma olhada rápida do Haiku. Ordem: agente da tarefa › combo do tipo › combo da dificuldade › padrão. A tarefa mostra "Visual · Strong", e trocar o tipo é um clique, guardado como correção |
| Fase 4: modelo por papel | ✅ feita: Settings › Agent › Combos › By role, com plano, etapas, verificador (o de outro fornecedor depende do combo escolhido) e revisor de PR |
| Fase 5: medir | ✅ feita: tokens e custo por combo e por alvo, se cada tarefa deu certo (chegou a In Review sem tarefa de correção depois, verificações passaram de primeira, sem troca de modelo ou de tipo), economia contra a base escolhida (padrão "tudo no Opus", preços numa tabela só) e sugestões só de leitura a partir de 10 tarefas; em Usage › Combos e no celular (Settings › Routing, `routing.usage`) |
| Fases 6, 6b e 6c: bots, bots especialistas e Bot Studio | ✅ feitas, na `feat/windows-port` (`src/core/bots/`, Settings › Bots, `docs/bots.md`): Your Mac como primeiro bot, bots em pastas com MCPs isolados, `plan_dispatch` com categoria → combo ou bot, conhecimento (OpenViking ou índice local), Bot Studio com git, exportar/importar e "Criar com o Claude". **Falta:** gatilhos de bot, MCPs em runtimes além do Claude Code, `openviking-server init` no WSL |
| Código das fases 1 a 5 | na branch `feat/windows-port` (commits `10ab8653`, `cb7fcab5`, `659a0631`, `b2636afb`), que também está no GitHub (fork privado); no ar no motor do WSL |
| Pendências para o celular | o telefone mostra o combo e o alvo de cada resposta, a dificuldade da tarefa e o Needs You de combo esgotado; editar combos é só no Mac, como manda o `CLAUDE.md` |
| Fase 7: idiomas (pt-BR) | não iniciada; hoje não há biblioteca de tradução, e os textos estão escritos direto no código |
| Navegador para os agentes | Playwright MCP registrado no Claude do WSL (escopo de usuário), com o Chromium já baixado, sem tela; vale para todas as conversas do Beluga do WSL |
| OpenViking (base do conhecimento da 6b) | instalado no WSL; falta `openviking-server init` |
| Modo WSL do app do Windows (pré-requisito para usar o app nativo) | commit `cd0a8c4c`, unificado na `feat/windows-port`; ainda não testado num app compilado |
| Branches | tudo unificado na `feat/windows-port` (porte para Windows, modo WSL, combos e roadmap), enviada ao GitHub; as branches e worktrees antigas foram apagadas |
| Testes (Windows) | typecheck limpo; suíte com 7.116 aprovados e 113 falhas do ambiente desta máquina (91 de links simbólicos sem o Modo de Desenvolvedor; o resto de locale pt-BR, CRLF, `tar`, Python e tempo esgotado) |
| Uso atual | o Beluga do WSL pelo navegador, em `127.0.0.1:7777`, já com as fases 1 a 5 |

**Próximos passos:**
1. Usar os combos por algumas semanas e olhar Usage › Combos. É o dado para calibrar os níveis e as categorias.
2. Completar a fase 3 com as categorias por nome e a fase 5 com a taxa de sucesso e a economia.
3. Testar o modo WSL num app compilado (`npm run tauri build`) e, se funcionar, usar o app nativo em vez do navegador.
4. Fase 7 (pt-BR), que pode correr em paralelo; o idioma dos agentes primeiro.
5. Fases 6, 6b e 6c (bots).

**Cuidados já descobertos:**
- No WSL, um `bash -c` sem login acha primeiro o `claude` do Windows (`/mnt/c`), que não enxerga os
  sub-agentes do WSL. Use um shell de login ou `~/.local/bin/claude`. O Beluga do WSL usa o Claude
  dele mesmo.
- O pareamento de "Your Computers" entre o app do Windows e o motor do WSL falha: o relay
  `cloudflared` nunca responde e o P2P não encontra o outro lado. Por isso existe o modo WSL.

## Referências

- 9router: [decolua/9router](https://github.com/decolua/9Router), gateway local compatível com
  OpenAI (`localhost:20128/v1`), com combos de fallback entre assinaturas, provedores baratos e
  gratuitos.
- [Resumo do 9router no mer.vin](https://mer.vin/2026/05/9router-one-openai-compatible-gateway-for-claude-code-codex-cursor-and-multi-provider-fallbacks/)
- oh-my-hermes: [rlaope/oh-my-hermes](https://github.com/rlaope/oh-my-hermes), com execuções em grafo
  (`/dag-ulw`), categorias de trabalho que mapeiam para cadeias de modelos, lanes (Claude Code, Codex,
  omp) e um app com bots na barra lateral e o painel Plans.
- `docs/local-models.md`, `docs/tasks-and-plans.md`, `docs/copilot.md`, `docs/opencode.md`
