# 9router no Beluga

> Objetivo: usar muitos provedores de LLM (GLM, Kimi, MiniMax, DeepSeek, OpenRouter, Gemini, Groq,
> Kiro grátis…) por um único endereço, o 9router, e combiná-los com o Claude e o Codex nos combos do
> Beluga, sem perder o controle de limite de uso, de privacidade e de gasto.

Status: proposta · criado em 2026-11-15

Relacionados: [roteamento-inteligente.md](roteamento-inteligente.md) (§2, a divisão entre Beluga e gateway),
[modo-orquestrador.md](modo-orquestrador.md) (executores baratos), `docs/routing.md`, `docs/local-models.md`.

## 1. O que é o 9router

Um proxy local de código aberto ([decolua/9router](https://github.com/decolua/9router)): `npm install -g 9router`
e `9router`. Painel e API em `http://localhost:20128`, mais de 40 provedores atrás de uma chave só, modelos
no formato `prefixo/modelo` (`glm/glm-5.1`, `kr/claude-sonnet-4.5`) e **combos próprios** com fallback,
chamados pelo nome como se fossem um modelo. `GET /v1/models` lista modelos e combos. Traz um RTK próprio
ligado por padrão (comprime a saída das ferramentas antes do modelo).

## 2. Quem faz o quê

Como já decidido no roteamento: **não construir um 9router dentro do Beluga**.

| Camada | Quem | Decide |
|---|---|---|
| Por tarefa, etapa, papel | **Beluga** (combos) | Claude, Codex ou 9router; para onde ir quando um plano esgota; privacidade; gasto |
| Por requisição, no mesmo nível | **9router** (combos dele) | repetir uma chamada, girar chaves, cair de GLM para MiniMax para Kimi |

Regra: **uma troca de provedor acontece numa camada só**. O combo do Beluga escolhe entre runtimes e
"o 9router"; o combo do 9router escolhe entre provedores de chave de API do mesmo nível.

## 3. O que já existe (não reinventar)

| Peça | Onde | Uso aqui |
|---|---|---|
| Endpoint compatível com Anthropic | `src/agent/runtime/local.ts` (`endpointEnv`), Settings › Agent › Local models › Add Endpoint | o 9router entra como endpoint: o Claude Code continua fazendo o trabalho, com as mesmas ferramentas e regras |
| Sonda de endpoints | `src/core/local-endpoints.ts:113-125`: `GET {base}/v1/models` a cada 30 s, com `x-api-key` e `Bearer` | o 9router responde a essa rota: modelos e combos aparecem sozinhos |
| Chave guardada | `~/.beluga/env.json`, nunca mostrada de novo | a chave do 9router |
| Combos com fallback e limite | `src/core/routing/model.ts`, `failover.ts` | `9router/<combo>` vira um alvo como qualquer outro |
| Privacidade do combo | `privacyWhy` em `src/core/routing/model.ts:322-326` | hoje só olha `onThisMac` (ver §4.3) |
| Usage por combo e alvo | Usage › Combos (`docs/routing.md`, fase 5) | gasto por alvo; endpoint próprio conta como US$ 0 |
| Stack | `src/core/stack/` (`docs/stack.md`) | olhar se o 9router está no ar e ligá-lo |

## 4. Cuidados (valem desde o primeiro dia)

1. **Assinaturas fora do 9router.** Ele oferece login OAuth no Claude Code (Pro/Max), no Codex, no Copilot
   e no Cursor. Não usar: assinatura atrás de proxy pode violar os termos do provedor, e o Beluga perde o
   controle de limite e o fallback por plano. Claude e Codex ficam nos runtimes do Beluga, como hoje.
   No 9router, só provedores de **chave de API** e **gratuitos**.
2. **Formato Anthropic.** O endpoint do Beluga é o Claude Code, que chama `POST /v1/messages`. O 9router
   documenta `/v1/chat/completions` e diz que traduz para o Claude, mas não mostra a rota `/v1/messages`.
   Confirmar antes de tudo (fase 0, passo 3).
3. **Privacidade errada.** Para o Beluga, um endpoint em `127.0.0.1` está "neste computador", então um
   combo `no-third-party` ou `local-only` aceitaria o 9router, que manda tudo para fora. Até a fase 1,
   usar o 9router só em combos `privacy: any`.
4. **Um modelo por execução.** `endpointEnv` aponta todos os apelidos (Opus, Sonnet, Haiku, sub-agentes,
   o modelo rápido) para o modelo escolhido. Uma execução no 9router usa o mesmo modelo para tudo.
5. **RTK em dobro.** O Claude Code já tem o hook `rtk hook claude`; o 9router tem o próprio RTK ligado.
   Deixar um só (desligar no painel do 9router, Endpoint settings) até medir.
6. **Segurança do painel.** Senha inicial padrão `123456` e `REQUIRE_API_KEY` desligado por padrão.
   Definir `INITIAL_PASSWORD`, ligar `REQUIRE_API_KEY=true` e escutar só em `127.0.0.1`.

## 5. Fases

### Fase 0: ligar à mão (sem código)

1. **No WSL** (onde roda o daemon): `npm install -g 9router`. Rodar com `INITIAL_PASSWORD` e
   `REQUIRE_API_KEY=true` como serviço do usuário (`systemd --user`, como o `beluga.service`), para
   voltar sozinho depois de um reinício.
2. **No painel**: cadastrar os provedores por chave de API; montar o combo `barato` (ex.: GLM → MiniMax →
   Kimi) e, se quiser, `gratis` (Kiro, OpenCode Free); gerar uma chave para o Beluga. Não conectar as
   contas do Claude Code nem do Codex.
3. **Testar o formato Anthropic**:

   ```bash
   curl -s http://127.0.0.1:20128/v1/messages -H "x-api-key: SUA_CHAVE" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d '{"model":"barato","max_tokens":50,"messages":[{"role":"user","content":"diga oi"}]}'
   ```

   Uma resposta com `"type":"message"` e `content` serve. Testar também com ferramentas (uma execução
   curta do Claude Code com `ANTHROPIC_BASE_URL` apontado para ele, lendo um arquivo): tradução de
   chamadas de ferramenta é onde os proxies mais falham.
4. **No Beluga**: Settings › Agent › Local models › Add Endpoint. Nome `9router`, endereço
   `http://127.0.0.1:20128` (**sem `/v1`**: o Beluga acrescenta `/v1/models` e o Claude Code
   `/v1/messages`), a chave, modelos vazio.
5. **Combos** (todos `privacy: any`): Economy vira Claude Sonnet → Codex → `9router/barato` → Ollama.
   Um combo novo "Grátis primeiro": `9router/gratis` → `9router/barato` → Claude Haiku.
6. **Ligar aos papéis**: `explore` e `docs` em "Grátis primeiro" para testar; milestones de plano no
   Economy; o conferente (`checker`) num provedor diferente do que construiu.
7. Anotar por duas semanas o que cada modelo do 9router resolve bem (dado para as fases 3 e 4).

### Fase 1: privacidade de gateways (a correção de código mais urgente)

- `LocalEndpoint` ganha `sendsOut: boolean` (o endpoint repassa a terceiros). Padrão: `false` para Ollama
  e LM Studio reconhecidos pela sonda (`/api/tags`, nomes de modelo locais); `true` para qualquer outro,
  inclusive em `127.0.0.1`. O usuário pode mudar na tela do endpoint.
- `privacyWhy` (`model.ts:322-326`): um alvo `local` em endpoint com `sendsOut` é tratado como terceiro.
  `no-third-party` e `local-only` o recusam, dizendo por quê ("o 9router repassa a outros provedores").
- Settings › Local models mostra um selo "repassa a terceiros" no endpoint.
- Teste: um combo `no-third-party` com `9router` em `127.0.0.1` pula esse alvo; com o Ollama, não.

### Fase 2: o 9router no Stack

- Novo item do Stack (`src/core/stack/probe.ts`): `9router`, olhado em `GET http://127.0.0.1:20128/v1/models`
  (um 401 conta como "no ar", como o hooktop). Ligado pelo Beluga quando existe a unidade
  `systemctl --user` dele.
- Checklist (fase 0b do [modo-orquestrador.md](modo-orquestrador.md)), itens novos:
  - o 9router exige chave (`REQUIRE_API_KEY`) e a senha não é a padrão;
  - `POST /v1/messages` responde no formato Anthropic (a sonda da fase 0, passo 3, automatizada com um
    modelo grátis e `max_tokens` mínimo, uma vez por dia);
  - nenhuma assinatura (Claude Code, Codex, Copilot, Cursor) conectada no 9router (pelo `/v1/models`:
    prefixos `cc/`, `cx/`, `gh/`, `cu/`); se houver, um aviso explicando o risco;
  - RTK ligado nas duas pontas.
- O que falhar vira o Needs You `stack` que já existe (chega ao celular).

### Fase 3: endpoint 9router com cara própria

- **Preset na tela Add Endpoint**: "9router" preenche o endereço (`http://127.0.0.1:20128`), pede só a
  chave e marca `sendsOut`.
- **Combos do 9router como alvos**: os nomes que `/v1/models` lista e que não têm `prefixo/` são combos
  do 9router; o seletor os mostra à parte ("9router · barato"), com um aviso quando um combo do Beluga
  e um do 9router repetem a mesma troca.
- **Qual modelo respondeu**: guardar no card da execução o `model` que o 9router devolve na resposta
  (o combo `barato` pode ter respondido com o MiniMax). O Usage separa por modelo de verdade, não só por
  "9router".
- **Limite do 9router**: quando ele responde 429 ou "combo esgotado", o Beluga trata como limite daquele
  endpoint (`limitKey` por endpoint já existe) e segue para o próximo alvo do combo.

### Fase 4: gasto e qualidade

- **Custo**: o Usage conta endpoint próprio como US$ 0, o que não vale para o 9router (ele usa chaves
  pagas). Uma tabela de preço por `prefixo/modelo` (editável), ou o custo que o 9router informa, se
  informar. Entra no orçamento da fase 4 do modo orquestrador.
- **Teste rápido de ferramentas por modelo** (o risco da §5 do roteamento): ao adicionar um modelo do
  9router, uma tarefa curta com ferramentas (ler um arquivo, listar uma pasta). Modelo que falha fica
  marcado "não usa ferramentas bem" e sai dos papéis que editam.
- **Relatório**: depois de duas semanas, quais modelos do 9router passaram no checker e quanto pouparam
  em relação ao Claude (Usage › Combos, "o que economizou").

### Fase 5: executores de outros provedores no meio da conversa

Depende da fase 3 do [modo-orquestrador.md](modo-orquestrador.md) (`delegate`): o principal no Claude
delega uma busca a um executor em `9router/gratis`, que devolve só o resumo. É o que permite combinar
provedores **dentro** de uma conversa, não só entre execuções.

## 6. Regras do repositório (CLAUDE.md)

- Métodos novos de API (o preset, `sendsOut`): classificar em `src/companion/coverage.ts` como `mac`
  (é configuração). O celular só mostra o selo e o modelo que respondeu.
- `docs/routing.md` (privacidade de gateways), `docs/local-models.md` (o preset e o `sendsOut`),
  `docs/stack.md` (o item do 9router) e `docs/parity.md` (a tela do endpoint).
- A chave do 9router segue a regra das chaves de endpoint: fica em `~/.beluga/env.json`, nunca vai para
  chat, relatório, sala ou celular.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Tradução de ferramentas do 9router falha e o agente se perde | teste de ferramentas antes de usar (fase 0 e 4); começar só em `explore` e `docs` |
| Assinatura conectada no 9router por engano | checklist avisa (fase 2); este plano diz para não conectar |
| Dados de um combo "privado" vazam pelo 9router | fase 1 antes de qualquer uso em combo que não seja `any` |
| Duas camadas de fallback escondem qual modelo respondeu | uma troca numa camada só (§2); guardar o modelo real (fase 3) |
| Painel aberto na rede | `127.0.0.1`, `REQUIRE_API_KEY`, senha própria (§4.6) |
| O projeto do 9router muda a API | a sonda diária da fase 2 pega antes de uma execução falhar |

## 8. Ordem sugerida

F0 (à mão, já dá) → **F1** (privacidade: pequena e necessária antes de confiar em combos privados) →
F2 (Stack) → F3 → F4 → F5 (junto com a fase 3 do modo orquestrador).

## 9. Situação e decisões (registro)

- **2026-11-15**: plano criado. Decidido: assinaturas (Claude, Codex, Copilot, Cursor) nunca atrás do
  9router; ele só com chaves de API e provedores grátis. Encontrado: `privacyWhy` trata endpoint em
  `127.0.0.1` como local, o que deixaria um gateway passar em combo privado. A confirmar: `POST
  /v1/messages` e tradução de chamadas de ferramenta no 9router.
