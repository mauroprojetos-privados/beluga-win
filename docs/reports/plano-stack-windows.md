# Plano: a stack de desenvolvimento multiagente no Windows

Baseado na nota do Cofre *Arquitetura e Orquestração Multiagente com Beluga, OMP, Herdr e Magpie*
(`D:\Projetos\Cofre\src\content\items\arquitetura-multiagente-beluga-herdr-magpie-mcp`) e no
estado real desta máquina em 2026-11-09.

## Onde estamos

| Peça | Neste PC | Observação |
|---|---|---|
| Beluga (engine + app) | código pronto para Windows | serviço, selo na barra de tarefas, APK e assinatura feitos nesta sessão; falta compilar o Rust |
| Node / npm | 24.19 / 11.17 | ok |
| Git, gh, winget | ok | `core.autocrlf=true` no gitconfig do sistema (causa falhas de teste) |
| Claude Code | instalado (Windows) | falta no WSL |
| Ollama | instalado | rota "modelo local" do Beluga já funciona |
| uv | instalado | `python` é só o atalho da Microsoft Store: falta Python de verdade |
| WSL Ubuntu 24.04 | rodando, `systemd=true`, Node 22 | `/etc/fstab` dá erro no `mount -a` (corrigir) |
| Rust / cargo | **não** | necessário para Beluga (Tauri), rtk, Hooktop |
| rtk, token-goat, Graphify/GitNexus, gls, OpenViking, Herdr, OMP, Hooktop | **não** | |
| Magpie | **rodando no WSL** (Docker, v0.1.3078) | gateway `127.0.0.1:3425`, web UI `127.0.0.1:3430`; roda em macOS, Windows e Linux |
| Docker | não | só necessário se o Langfuse for local |
| Modo de Desenvolvedor | desligado | sem ele, symlinks falham (≈95 testes do Beluga) |

## A decisão de arquitetura: Windows + WSL, cada um com o que faz melhor

```
 Windows (nativo)                               WSL Ubuntu 24.04
 ┌───────────────────────────────┐              ┌─────────────────────────────────────┐
 │ Beluga app (Tauri)            │  P2P/local   │ Beluga engine (beluga service =     │
 │  torre de controle, worktrees │◄────────────►│   systemd) como "computador" WSL    │
 │ Beluga engine (service=tarefa)│              │ Claude Code + rtk (hook bash)       │
 │ Ollama (GPU do Windows)       │◄── :11434 ───│ token-goat, Graphify/GitNexus, gls  │
 │ Hooktop TUI (opcional)        │              │ Herdr (multiplexador, precisa PTY   │
 └───────────────────────────────┘              │   Unix), OMP                        │
                                                │ Magpie (gateway de modelos, Docker) │
                                                │ OpenViking (Python/uv)              │
                                                └─────────────────────────────────────┘
                                                          │ traces
                                                          ▼
                                                 Langfuse na VPS (langfuse.itmmc.com.br)
```

Por quê: o app e o Ollama ganham com o Windows nativo (janela, GPU). As ferramentas de terminal
da nota (Herdr, hooks em bash do rtk, gls) nasceram para Unix e rodam sem adaptação no WSL. O
Beluga já trata o WSL como um computador seu ("Ubuntu 24.04 · WSL", `docs/machines.md`), então o
app no Windows comanda os agentes que rodam no WSL.

Regra da nota mantida: **o código mora só nas worktrees**. Os repositórios que os agentes editam
ficam no disco do WSL (`~/projetos`), nunca em `/mnt/d`. Acessar o NTFS pelo WSL é lento e
bagunça permissões e quebras de linha.

---

## Fase 0: a base do Windows (½ dia)

1. **Modo de Desenvolvedor:** Configurações › Sistema › Para desenvolvedores › ligado.
2. **Quebras de linha:** `git config --global core.autocrlf input`, depois reclonar o Beluga ou
   rodar `git add --renormalize .` num clone limpo.
3. **Rust (MSVC) e C++ Build Tools:**
   ```
   winget install Rustlang.Rustup
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
   ```
4. **Python de verdade (via uv, que já está instalado):** `uv python install 3.12`. Depois
   desligar os atalhos `python.exe` da Store em Configurações › Apps › Aliases de execução.
5. **WSL:** corrigir a linha quebrada do `/etc/fstab` e conferir `systemctl --user status`.

**Pronto quando:** `cargo --version`, `uv run python -V` e `wsl -d Ubuntu-24.04 systemctl --user status`
responderem sem erro.

## Fase 1: Beluga no Windows, compilado e verde (1 dia)

1. `npm ci` (raiz e `packages/mac`). Rodar `npx vitest run`: com a Fase 0 feita, as falhas de
   symlink e CRLF somem. As 2 de moeda passam com `LANG=en_US.UTF-8`.
2. `node scripts/build-sidecar.mjs` (no PowerShell), depois `cd packages/mac && npx tauri dev`.
3. Testar à mão o que foi portado nesta sessão:
   - o selo na barra de tarefas;
   - `beluga service install`, reiniciar a sessão, `beluga status` deve dizer "a scheduled task";
   - `beluga service remove`.
4. `cargo clippy` e `cargo test` em `packages/mac/src-tauri`. O `badge.rs` novo tem testes.
5. `npx tauri build`: gera o instalador NSIS.
6. Commit com a linha `Tested-on` só se rodar num Mac. No Windows, o CI faz o macOS.

**Pronto quando:** o app abre, o selo aparece com mensagens não lidas e o serviço sobrevive a sair e entrar de novo na conta.

## Fase 2: o WSL como máquina de agentes (½ dia)

1. No WSL: Node 24 (via `nvm` ou `fnm`), `npm i -g @anthropic-ai/claude-code`, `claude login`.
2. Beluga engine no WSL: build do repositório, `beluga service install` (aqui usa o systemd),
   `beluga pair` com o app do Windows (*Seus computadores*).
3. Ollama visto do WSL: com `networkingMode=mirrored` no `%UserProfile%\.wslconfig`, o WSL
   alcança `localhost:11434` do Windows. Configurar no Beluga › Local model.

**Pronto quando:** o app do Windows mostra "Ubuntu 24.04 · WSL" e abre uma worktree lá com o Claude respondendo.

## Fase 3: economia de tokens (1–2 dias)

A ordem segue o funil da nota: macro → estrutural → micro → trava.

| # | Ferramenta | Onde | Instalação (confirmar no repositório oficial antes) | Verificação |
|---|---|---|---|---|
| 1 | **rtk** (proxy de CLI que compacta a saída) | WSL (e opcional no Windows) | `cargo install --git https://github.com/rtk-ai/rtk`, depois `rtk init -g` (instala o hook no Claude Code) | `rtk git status` e `rtk gain` mostram a economia; `RTK_DISABLED=1` para o cenário A |
| 2 | **token-goat** (bisturi de símbolos) | WSL | pelo repositório do projeto | `token-goat symbol <fn>` devolve só a função |
| 3 | **Graphify / GitNexus** (grafo AST, raio de impacto) | WSL | pelo repositório; indexar cada repositório | consulta de quem chama uma função conhecida |
| 4 | **gls** (Graph-Loop Solo: `baseline`, `gate` de 3 falhas) | WSL | pelo repositório | provocar o mesmo erro 3× e ver `exit 3` |
| 5 | **OpenViking** (`viking://`, LOD L0/L1/L2) | WSL, `uv` | `uv tool install` / `uv pip install` conforme o README | `ls viking://resources/` com specs, sem código |

Poda da nota, aplicada desde o início:
- RuVector fora da esteira de código;
- memória de longo prazo no `viking://memory/`, e não no `gls memory`;
- `.agents/skills/` espelhado em `viking://skills/`.

Sobre o rtk no Windows nativo: o hook dele é um script de shell. No Windows, o Claude Code roda os
hooks pelo Git Bash, então deve funcionar, mas é preciso testar. Se falhar, o rtk fica só no WSL.

**Pronto quando:** uma tarefa real passa pelas 4 etapas e o `rtk gain` mostra redução.

### A stack em cada tarefa nova: `beluga-stack-setup`

O script está no WSL em `~/.local/bin/beluga-stack-setup` e é o comando de setup de cada projeto
no Beluga: **Project Settings › Setup** = `beluga-stack-setup npm ci`, com o setup do próprio
projeto depois do nome. Deixe **"Save to beluga.json" desmarcado**, porque o script só existe na
sua máquina.

- **Segura a tarefa só por milissegundos (21 ms medidos):**
  - o setup do projeto, cuja falha derruba a worktree;
  - os arquivos da stack no `.git/info/exclude`, para não aparecerem em Changes nem em commits.
- **Em segundo plano, com `nice` e uma trava por repositório** (uma worktree indexa por vez):
  `graph-loop init`, `token-goat index` e `gitnexus analyze`. No repositório do Beluga isso levou
  cerca de 53 minutos. O agente começa antes e passa a usar cada índice quando ele fica pronto.
- **Log com o tempo de cada passo:** `~/.cache/beluga-stack/<worktree>.log`.

## Fase 4: orquestração e modelos (1–2 dias)

1. **Herdr** (multiplexador e estados `idle`/`busy`/`blocked`/`done`) e **OMP** no WSL.
2. **Magpie** (`yetone/magpie`, MIT) no WSL, pela imagem oficial, só em loopback:
   ```
   docker run -d --name magpie -p 127.0.0.1:3425:3425 -p 127.0.0.1:3430:3430 \
     -e MAGPIE_WEB_KEY="$(cat ~/.config/magpie-docker/web-key)" -v magpie-config:/config \
     ghcr.io/yetone/magpie:stable web --addr 0.0.0.0:3430 --no-open
   ```
   - **Web UI:** `docker logs magpie` mostra o link com a chave. Lá você adiciona os provedores
     (Anthropic, DeepSeek, Ollama em `http://host.docker.internal:11434` ou o IP do host) e cria
     uma chave de gateway.
   - **Rotas por agente:** `magpie claude <provedor/modelo>`. Para failover, um grupo com
     `magpie group add "..." models=... routing=smart`. Raciocínio → Opus 5.5; código → Sonnet 5.5;
     mecânico → Haiku 5.5, Qwen no Ollama ou DeepSeek.
   - **Beluga:** Settings › Claude › Local models › Add Endpoint, endereço `http://127.0.0.1:3425`
     com a chave de gateway (`docs/local-models.md`).
   - **Outros agentes:** `ANTHROPIC_BASE_URL=http://127.0.0.1:3425` (Anthropic) ou
     `OPENAI_BASE_URL=http://127.0.0.1:3425/v1` (OpenAI).
   - Para sobreviver a reinícios: `docker update --restart unless-stopped magpie`.
   - A nota fala em "Claude 3.7 Sonnet": hoje use a família Claude 5 (`claude-opus-5-5`,
     `claude-sonnet-5-5`, `claude-haiku-5-5`).
3. **Watchdog:** usar o **Sentinel** do Beluga (`docs/sentinel.md`) como gerente. Ele roda nos
   agendamentos, faz rollback para o checkpoint e escala o modelo depois de um `gls gate` com
   `exit 3`. É melhor do que criar um daemon novo.

**Pronto quando:** derrubar um provedor no Magpie e a tarefa seguir pelo grupo de failover; um agente que falha 3× fica amarelo no Beluga.

## Fase 5: observabilidade (1 dia)

1. **Hooktop** (`mauro-devops/hooktop`, Rust): `cargo install --path .` e `hooktop hooks install`.
   Instalar onde o Claude roda: no WSL e, se usar, no Windows também.
   - Atenção à porta **4317**: é a padrão do OTLP. Se algum coletor OpenTelemetry rodar na
     máquina, mude uma das duas.
   - Aqui já existem hooks no `~/.claude/settings.json` do Windows (5 entradas): juntar, sem
     sobrescrever.
2. **Langfuse:** `hooktop export` → ingestão na VPS. Chaves de API em variável de ambiente ou no
   Credential Manager, nunca em arquivo versionado.
   - O endereço da nota usa `https` na porta 3000: confirmar se o TLS termina ali ou num proxy.

**Pronto quando:** uma sessão aparece no TUI do Hooktop e, minutos depois, como trace no Langfuse.

## Fase 6: barramento MCP (½ dia)

1. `beluga mcp on`: agentes de fora (OMP, um Claude em outro terminal) controlam o Beluga em
   `http://127.0.0.1:7778/mcp`. Ler antes `docs/security.md#external-agents`.
2. MCPs de domínio (Astryx, Rigby2D) só quando um projeto pedir. Confirmar se existem e de onde
   vêm antes de instalar.

## Fase 7: prova (½ dia)

Rodar o benchmark A/B da nota com o mesmo prompt: cenário A com `RTK_DISABLED=1` e o Claude puro;
cenário B com a stack completa. Comparar no Hooktop:
- tokens novos por turno;
- `cache_read`;
- linhas de terminal;
- custo.

Guardar o resultado no Cofre. Esses números medidos substituem as estimativas da nota (−90%).

---

## Riscos e cuidados

- **Ferramentas não verificadas:** rtk, Hooktop e Magpie foram conferidos no repositório oficial. token-goat, Graphify/GitNexus,
  gls, OpenViking, Herdr, OMP, Astryx e Rigby2D vêm da nota. Antes de cada instalação, confirmar o
  repositório oficial, a licença e o suporte ao sistema. Instalar só do repositório oficial.
- **Hooks acumulados:** rtk, Hooktop e o Beluga mexem nos hooks do Claude Code. Fazer backup do
  `settings.json` antes de cada fase e instalar um de cada vez.
- **Assinatura do Windows:** o workflow já está pronto. Falta comprar ou emitir um certificado de
  assinatura de código e criar os secrets `WINDOWS_CERTIFICATE` e `WINDOWS_CERTIFICATE_PASSWORD`.
- **Tempo total estimado:** 6–9 dias de trabalho focado, sendo as Fases 0–2 o caminho crítico.
