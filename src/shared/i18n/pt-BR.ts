import type { Key } from './en.js';
import type { Message } from './message.js';
import * as sidebar from './areas/sidebar.js';
import * as composer from './areas/composer.js';
import * as settings from './areas/settings.js';
import * as tasks from './areas/tasks.js';
import * as plans from './areas/plans.js';
import * as phone from './areas/phone.js';

/**
 * Brazilian Portuguese. A key missing here is said in English (never blank); tests/i18n.test.ts
 * lists the ones missing. Which product words stay in English: docs/i18n.md.
 */
export const ptBR: Partial<Record<Key, Message>> = {
  'common.cancel': 'Cancelar',
  'common.close': 'Fechar',
  'common.save': 'Salvar',
  'common.done': 'Concluído',
  'common.ok': 'OK',
  'common.on': 'Ligado',
  'common.off': 'Desligado',
  'common.yes': 'Sim',
  'common.no': 'Não',
  'common.allow': 'Permitir',
  'common.deny': 'Negar',
  'common.send': 'Enviar',
  'common.stop': 'Parar',
  'common.retry': 'Tentar de novo',
  'common.delete': 'Apagar',
  'common.open': 'Abrir',
  'common.back': 'Voltar',
  'common.more': 'Mais',
  'common.loading': 'Carregando…',
  'common.search': 'Buscar',
  'common.settings': 'Ajustes',
  'common.notNow': 'Agora não',

  'language.title': 'Idioma',
  'language.auto': 'Automático ({language})',
  'language.autoPlain': 'Automático (o do sistema)',
  'language.hint': 'Menus, botões e notificações, e o idioma em que seus agentes respondem.',
  'language.macShort': 'Seu Mac',
  'language.followMac': 'O mesmo do Mac ({language})',
  'language.phoneHint': 'O idioma deste celular. Por padrão, ele segue o seu Mac.',
  'language.commits': 'Idioma dos commits e PRs',
  'language.commitsHint': 'Em que idioma as mensagens de commit e os pull requests deste projeto são escritos. Não segue o idioma do app.',

  'common.and': 'e',

  'time.now': 'agora',
  'time.ago': 'há {n} {unit}',
  'time.in': 'em {n} {unit}',
  'time.second': { one: 'segundo', other: 'segundos' },
  'time.minute': { one: 'minuto', other: 'minutos' },
  'time.hour': { one: 'hora', other: 'horas' },
  'time.day': { one: 'dia', other: 'dias' },
  'time.month': { one: 'mês', other: 'meses' },
  'time.year': { one: 'ano', other: 'anos' },

  'notify.finished': '{who} terminou em {where}',
  'notify.done': 'Pronto',
  'notify.planFor': '{who} tem um plano para {where}',
  'notify.planForBody': 'Aprove, ou diga o que mudar',
  'notify.yourCall': 'Sua decisão em {where}',
  'notify.conflict': 'Conflito de merge em {where}',
  'notify.conflictFiles': '{count} arquivo(s): {files}',
  'notify.joined': '{name} entrou',
  'notify.joinedAgent': 'Trouxe o seu {agent}',
  'notify.joinedHi': 'Diga oi no chat do grupo',
  'notify.left': '{name} saiu',
  'notify.leftAgent': 'O {agent} saiu junto',
  'notify.leftRoom': 'Saiu da sala',
  'notify.testTitle': 'As notificações funcionam',
  'notify.testBody': 'É assim que o Beluga avisa que seu agente terminou ou precisa de você',

  'needs.allowOnce': 'Permitir uma vez',
  'needs.approve': 'Aprovar',
  'needs.decline': 'Recusar',
  'needs.always': 'Sempre',
  'needs.keepPlanning': 'Continuar planejando',
  'needs.skip': 'Pular',
  'needs.ask': 'Perguntar',
  'needs.notNow': 'Agora não',
  'needs.resume': 'Retomar',
  // agent-wording: claude (a plan's merge fixer is Claude, as needs-you.ts always said)
  'needs.askClaudeAgain': 'Pedir ao Claude de novo',
  'needs.fix': 'Corrigir',
  'needs.approveAnyway': 'Aprovar mesmo assim',
  'needs.discard': 'Descartar',
  'needs.verifyThenApprove': 'Verificar e aprovar',
  'needs.pass': 'Passar',
  'needs.checkAgain': 'Conferir de novo',
  'needs.letIn': 'Deixar entrar',
  'needs.turnAway': 'Recusar',
  'needs.send': 'Enviar',
  'needs.sendChanges': 'Enviar mudanças',
  'needs.next': 'Próxima',
  'needs.sendBack': 'Devolver',
  'needs.planToApprove': '{owner} tem um plano para você aprovar',
  'needs.askAgent': 'Perguntar a {agent}?',
  'needs.aTask': 'Uma tarefa',
  'needs.taskStalled': '“{title}” parou duas vezes: retomar?',
  // agent-wording: claude
  'needs.conflictStuck': 'Um conflito de merge que o Claude não conseguiu resolver',
  'needs.reviewFound': { one: 'O revisor achou uma coisa para corrigir em “{title}”', other: 'O revisor achou {count} coisas para corrigir em “{title}”' },
  'needs.approvePlan': 'Aprovar o plano “{title}”?',
  'needs.approveChanges': 'Aprovar as mudanças em “{title}”?',
  'needs.milestoneReady': '“{title}” está pronto: passar?',
  'needs.milestoneMergeFailed': 'Não deu para fazer o merge de “{title}”: passar de novo?',
  'needs.wantsToComeIn': '{name} quer entrar',
  'needsYou.count': { one: '{count} coisa precisa de você', other: '{count} coisas precisam de você' },

  ...sidebar.ptBR,
  ...composer.ptBR,
  ...settings.ptBR,
  ...tasks.ptBR,
  ...plans.ptBR,
  ...phone.ptBR,
};
