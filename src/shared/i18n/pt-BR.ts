import type { Key } from './en.js';
import type { Message } from './message.js';

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

  'needsYou.count': { one: '{count} coisa precisa de você', other: '{count} coisas precisam de você' },
};
