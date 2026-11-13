import type { Message } from '../message.js';

/** Your stack (docs/stack.md): Settings › Stack, its notice and Needs You item, setting a project up. Keys start with `stack.`. */
export const en = {
  // What each check is called
  'stack.name.ollama': 'Ollama',
  'stack.name.openviking': 'OpenViking',
  'stack.name.hooktop': 'hooktop',
  'stack.name.rtk': 'RTK',
  'stack.name.tokenGoat': 'token-goat',
  'stack.name.gitnexus': 'GitNexus',
  'stack.name.graphify': 'graphify',
  'stack.name.gls': 'graph-loop-solo (gls)',

  // What each is for
  'stack.what.ollama': 'Local models: OpenViking’s embeddings and summaries',
  'stack.what.openviking': 'Your agents’ context memory: documentation and decisions, searched by meaning',
  'stack.what.hooktop': 'Records your agents’ tool calls, subagents and CPU/RAM',
  'stack.what.rtk': 'Shrinks command output before it reaches your agents',
  'stack.what.tokenGoat': 'Reads only the symbol or section an agent needs',
  'stack.what.gitnexus': 'The code’s graph: callers, impact, execution flows',
  'stack.what.graphify': 'A knowledge graph of the project, for graph-loop-solo',
  'stack.what.gls': 'graph-loop-solo’s command line: runs a task end to end and keeps the indexes fresh',

  // How to fix each
  'stack.fix.ollama': 'Open the Ollama app (on Windows, from the Start menu), or install it from ollama.com.',
  'stack.fix.openviking': 'Start it with `setsid nohup openviking-server > ~/.openviking/server.log 2>&1 &`.',
  'stack.fix.hooktop': 'Start it with `systemctl --user start hooktop`, or run `hooktop serve`.',
  'stack.fix.rtk': 'Install RTK and run `rtk init -g`.',
  'stack.fix.tokenGoat': 'Install token-goat and put it on your PATH (~/.local/bin).',
  'stack.fix.gitnexus': 'Install it with `npm install -g gitnexus`, then `gitnexus setup`.',
  'stack.fix.graphify': 'Install it with `pip install graphifyy`.',
  'stack.fix.gls': 'Install graph-loop-solo and put `gls` on your PATH.',

  // Its state
  'stack.state.up': 'Running',
  'stack.state.installed': 'Installed',
  'stack.state.down': 'Not running',
  'stack.state.missing': 'Not installed',
  'stack.state.starting': 'Starting…',

  // The notice and Needs You
  'stack.notice.title': 'Your stack needs you',
  'stack.notice.body': 'Not running or not installed: {list}',
  'stack.needs.title': {
    one: '{list} isn’t ready',
    other: '{list} aren’t ready',
  },
  'stack.needs.line': '{name}: {fix}',
  'stack.needs.checkAgain': 'Check Again',

  // Setting a project up
  'stack.step.gitnexus': 'GitNexus',
  'stack.step.graphify': 'graphify',
  'stack.step.openviking': 'OpenViking (its documentation)',
  'stack.toast.settingUp': 'Setting {name} up for your stack…',
  'stack.toast.done': '{name} is set up: {list}.',
  'stack.toast.doneNothing': '{name} is set up (none of the stack’s indexes is installed here).',
  'stack.toast.wrote': '{files}: new, not committed.',
  'stack.toast.someFailed': 'Couldn’t: {list}.',
  'stack.toast.failed': 'Couldn’t set {name} up for your stack: {why}',
  'stack.toast.noProject': 'That project isn’t here any more',

  // Settings › Stack
  'stack.settings.group': 'Your stack',
  'stack.settings.detail': 'What your agents lean on, looked at every few minutes. Something down or missing waits for you in Needs You.',
  'stack.settings.checkNow': 'Check Now',
  'stack.settings.checking': 'Checking…',
  'stack.settings.never': 'Not looked at yet',
  'stack.settings.lastChecked': 'Looked at {time}',
  'stack.settings.options': 'Automatically',
  'stack.settings.repair': 'Start services that are down',
  'stack.settings.repairDetail': 'Ollama, OpenViking and hooktop: once per outage, then it tells you',
  'stack.settings.bootstrap': 'Set up new projects',
  'stack.settings.bootstrapDetail': 'As a project is added or made: git if it has none, GitNexus and graphify index it, OpenViking gets its docs, and a beluga.json and CLAUDE.md where it has none (not committed)',
  'stack.settings.services': 'Services',
  'stack.settings.tools': 'Tools',

  // A project's ••• menu
  'stack.menu.setUp': 'Set Up Stack',
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
  'stack.name.ollama': 'Ollama',
  'stack.name.openviking': 'OpenViking',
  'stack.name.hooktop': 'hooktop',
  'stack.name.rtk': 'RTK',
  'stack.name.tokenGoat': 'token-goat',
  'stack.name.gitnexus': 'GitNexus',
  'stack.name.graphify': 'graphify',
  'stack.name.gls': 'graph-loop-solo (gls)',

  'stack.what.ollama': 'Modelos locais: os embeddings e os resumos do OpenViking',
  'stack.what.openviking': 'A memória de contexto dos seus agentes: documentação e decisões, buscadas pelo sentido',
  'stack.what.hooktop': 'Registra as ferramentas, os subagentes e o uso de CPU/RAM dos seus agentes',
  'stack.what.rtk': 'Encolhe a saída dos comandos antes de chegar aos agentes',
  'stack.what.tokenGoat': 'Lê só o símbolo ou a seção de que o agente precisa',
  'stack.what.gitnexus': 'O grafo do código: quem chama quem, impacto, fluxos',
  'stack.what.graphify': 'Um grafo de conhecimento do projeto, para o graph-loop-solo',
  'stack.what.gls': 'A linha de comando do graph-loop-solo: faz uma tarefa do início ao fim e mantém os índices em dia',

  'stack.fix.ollama': 'Abra o app do Ollama (no Windows, pelo menu Iniciar) ou instale pelo ollama.com.',
  'stack.fix.openviking': 'Inicie com `setsid nohup openviking-server > ~/.openviking/server.log 2>&1 &`.',
  'stack.fix.hooktop': 'Inicie com `systemctl --user start hooktop` ou rode `hooktop serve`.',
  'stack.fix.rtk': 'Instale o RTK e rode `rtk init -g`.',
  'stack.fix.tokenGoat': 'Instale o token-goat e coloque-o no PATH (~/.local/bin).',
  'stack.fix.gitnexus': 'Instale com `npm install -g gitnexus` e rode `gitnexus setup`.',
  'stack.fix.graphify': 'Instale com `pip install graphifyy`.',
  'stack.fix.gls': 'Instale o graph-loop-solo e coloque o `gls` no PATH.',

  'stack.state.up': 'Rodando',
  'stack.state.installed': 'Instalado',
  'stack.state.down': 'Parado',
  'stack.state.missing': 'Não instalado',
  'stack.state.starting': 'Iniciando…',

  'stack.notice.title': 'Sua stack precisa de você',
  'stack.notice.body': 'Parado ou não instalado: {list}',
  'stack.needs.title': {
    one: '{list} não está pronto',
    other: '{list} não estão prontos',
  },
  'stack.needs.line': '{name}: {fix}',
  'stack.needs.checkAgain': 'Verificar de novo',

  'stack.step.gitnexus': 'GitNexus',
  'stack.step.graphify': 'graphify',
  'stack.step.openviking': 'OpenViking (a documentação)',
  'stack.toast.settingUp': 'Preparando {name} para a sua stack…',
  'stack.toast.done': '{name} está pronto: {list}.',
  'stack.toast.doneNothing': '{name} está pronto (nenhum índice da stack está instalado aqui).',
  'stack.toast.wrote': '{files}: novos, sem commit.',
  'stack.toast.someFailed': 'Não deu: {list}.',
  'stack.toast.failed': 'Não deu para preparar {name} para a sua stack: {why}',
  'stack.toast.noProject': 'Esse projeto não está mais aqui',

  'stack.settings.group': 'Sua stack',
  'stack.settings.detail': 'O que os seus agentes usam, verificado a cada poucos minutos. O que estiver parado ou faltando espera por você em Precisa de você.',
  'stack.settings.checkNow': 'Verificar agora',
  'stack.settings.checking': 'Verificando…',
  'stack.settings.never': 'Ainda não verificado',
  'stack.settings.lastChecked': 'Verificado {time}',
  'stack.settings.options': 'Automaticamente',
  'stack.settings.repair': 'Iniciar serviços parados',
  'stack.settings.repairDetail': 'Ollama, OpenViking e hooktop: uma vez por queda; depois ele avisa você',
  'stack.settings.bootstrap': 'Preparar projetos novos',
  'stack.settings.bootstrapDetail': 'Quando um projeto é adicionado ou criado: git se não tiver, GitNexus e graphify indexam, o OpenViking recebe a documentação, e um beluga.json e um CLAUDE.md onde não houver (sem commit)',
  'stack.settings.services': 'Serviços',
  'stack.settings.tools': 'Ferramentas',

  'stack.menu.setUp': 'Preparar a stack',
};
