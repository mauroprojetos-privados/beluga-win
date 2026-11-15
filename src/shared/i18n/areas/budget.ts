import type { Message } from '../message.js';

/**
 * Token budgets (docs/budget.md, shared/budget.ts): a stopped run's card, the Needs You item and its
 * buttons, the chat's budget chip, Settings › Agent › Budget, the Usage card and the phone's band.
 * Keys start with `budget.`.
 */
export const en = {
  // A run a budget stopped (shared/run-failure.ts)
  'budget.failure.conversation': 'Stopped at this conversation’s token budget · {used} of {limit}',
  'budget.failure.day': 'Stopped at your daily token budget · {used} of {limit}',
  'budget.failure.project': 'Stopped at {name}’s daily token budget · {used} of {limit}',
  'budget.failure.bot': 'Stopped at {name}’s daily token budget · {used} of {limit}',

  // Needs You (companion/needs-you.ts)
  'budget.needs.conversation': 'This conversation reached its token budget',
  'budget.needs.day': 'You reached your daily token budget',
  'budget.needs.project': '{name} reached its daily token budget',
  'budget.needs.bot': '{name} reached its daily token budget',
  'budget.needs.detail': '{used} of {limit} tokens ({pct}%). Continue gives it half the budget again; Go On Cheaper continues on a cheaper model; Stop leaves it stopped.',
  'budget.needs.continue': 'Continue',
  'budget.needs.cheaper': 'Go On Cheaper',
  'budget.needs.stop': 'Stop',

  // The stopped card's buttons on the Mac
  'budget.card.continueTip': 'Give it half the budget again and continue',
  'budget.card.cheaperTip': 'Continue past the budget on a cheaper model',

  // The chat's budget chip
  'budget.meter.aria': 'Token budget: {label}',
  'budget.meter.plan': '5h {pct}%',
  'budget.meter.conversation': 'This conversation: {used} of {limit} ({pct}%)',
  'budget.meter.day': 'Your day: {used} of {limit} ({pct}%)',
  'budget.meter.project': '{name} today: {used} of {limit} ({pct}%)',
  'budget.meter.bot': '{name} today: {used} of {limit} ({pct}%)',
  'budget.meter.planLine': 'Your plan’s 5-hour window: {pct}%',
  'budget.meter.cheaperNow': 'Past its budget: it continues on a cheaper model',
  'budget.meter.near.downgrade': 'At a budget it continues on a cheaper model',
  'budget.meter.near.ask': 'At a budget it stops and asks you',
  'budget.meter.near.stop': 'At a budget it stops',

  // Settings › Agent › Budget
  'budget.settings.group': 'Token budget',
  'budget.settings.none': 'No budget',
  'budget.settings.tokens': '{n} tokens',
  'budget.settings.conversation': 'Per conversation',
  'budget.settings.conversationDetail': 'What one conversation may spend over its life. A bot’s bot.json can set its own; a project’s beluga.json can only lower it.',
  'budget.settings.day': 'Per day',
  'budget.settings.dayDetail': 'What all your conversations may spend in a day. Nothing restarts on its own past it, not even after a usage limit resets.',
  'budget.settings.near': 'When one is reached',
  'budget.settings.nearChoice.downgrade': 'Continue cheaper',
  'budget.settings.nearChoice.ask': 'Ask me',
  'budget.settings.nearChoice.stop': 'Stop',
  'budget.settings.nearDetail.downgrade': 'It continues on the combo’s next target, or Opus → Sonnet → Haiku.',
  'budget.settings.nearDetail.ask': 'It stops and asks in Needs You, on your phone too: continue, continue cheaper, or stop.',
  'budget.settings.nearDetail.stop': 'It stops. Continue on its card gives it more.',
  'budget.settings.allowed': 'Allowed past a budget',
  'budget.settings.allowedDetail': { one: '{count} conversation or day you let go on', other: '{count} conversations or days you let go on' },
  'budget.settings.clearAllowed': 'Clear',

  // Usage › Right now
  'budget.usage.title': 'Budget',
  'budget.usage.conversation': 'This conversation',
  'budget.usage.day': 'Your day',
  'budget.usage.project': 'Project',
  'budget.usage.bot': 'Bot',
  'budget.usage.meter': '{pct}% of the budget',
  'budget.usage.of': '{used} of {limit} tokens',
  'budget.usage.none': 'Today: {used} tokens. No daily budget yet: Settings › Agent › Budget.',
  'budget.usage.plan': 'Your plan’s 5-hour window: {pct}%',
  'budget.usage.planResets': 'Your plan’s 5-hour window: {pct}% · resets {when}',

  // The phone
  'budget.phone.title': 'Token budget',
  'budget.phone.of': '{used} of {limit}',
  'budget.phone.kind': 'Budget',
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
  'budget.failure.conversation': 'Parou no orçamento de tokens desta conversa · {used} de {limit}',
  'budget.failure.day': 'Parou no seu orçamento diário de tokens · {used} de {limit}',
  'budget.failure.project': 'Parou no orçamento diário de tokens de {name} · {used} de {limit}',
  'budget.failure.bot': 'Parou no orçamento diário de tokens de {name} · {used} de {limit}',

  'budget.needs.conversation': 'Esta conversa chegou ao orçamento de tokens',
  'budget.needs.day': 'Você chegou ao seu orçamento diário de tokens',
  'budget.needs.project': '{name} chegou ao orçamento diário de tokens',
  'budget.needs.bot': '{name} chegou ao orçamento diário de tokens',
  'budget.needs.detail': '{used} de {limit} tokens ({pct}%). Continuar dá mais metade do orçamento; Seguir mais barato continua num modelo mais barato; Parar deixa parada.',
  'budget.needs.continue': 'Continuar',
  'budget.needs.cheaper': 'Seguir mais barato',
  'budget.needs.stop': 'Parar',

  'budget.card.continueTip': 'Dar mais metade do orçamento e continuar',
  'budget.card.cheaperTip': 'Continuar além do orçamento num modelo mais barato',

  'budget.meter.aria': 'Orçamento de tokens: {label}',
  'budget.meter.plan': '5h {pct}%',
  'budget.meter.conversation': 'Esta conversa: {used} de {limit} ({pct}%)',
  'budget.meter.day': 'Seu dia: {used} de {limit} ({pct}%)',
  'budget.meter.project': '{name} hoje: {used} de {limit} ({pct}%)',
  'budget.meter.bot': '{name} hoje: {used} de {limit} ({pct}%)',
  'budget.meter.planLine': 'Janela de 5 horas do seu plano: {pct}%',
  'budget.meter.cheaperNow': 'Passou do orçamento: segue num modelo mais barato',
  'budget.meter.near.downgrade': 'No orçamento, segue num modelo mais barato',
  'budget.meter.near.ask': 'No orçamento, para e pergunta a você',
  'budget.meter.near.stop': 'No orçamento, para',

  'budget.settings.group': 'Orçamento de tokens',
  'budget.settings.none': 'Sem orçamento',
  'budget.settings.tokens': '{n} tokens',
  'budget.settings.conversation': 'Por conversa',
  'budget.settings.conversationDetail': 'Quanto uma conversa pode gastar na vida toda. O bot.json de um bot pode definir o seu; o beluga.json de um projeto só pode baixá-lo.',
  'budget.settings.day': 'Por dia',
  'budget.settings.dayDetail': 'Quanto todas as suas conversas podem gastar num dia. Passado ele, nada volta a rodar sozinho, nem depois que o limite de uso reinicia.',
  'budget.settings.near': 'Ao chegar num',
  'budget.settings.nearChoice.downgrade': 'Seguir mais barato',
  'budget.settings.nearChoice.ask': 'Perguntar',
  'budget.settings.nearChoice.stop': 'Parar',
  'budget.settings.nearDetail.downgrade': 'Segue no próximo alvo do combo, ou Opus → Sonnet → Haiku.',
  'budget.settings.nearDetail.ask': 'Para e pergunta em Needs You, no celular também: continuar, seguir mais barato ou parar.',
  'budget.settings.nearDetail.stop': 'Para. Continuar no cartão dá mais.',
  'budget.settings.allowed': 'Liberado além do orçamento',
  'budget.settings.allowedDetail': { one: '{count} conversa ou dia que você deixou seguir', other: '{count} conversas ou dias que você deixou seguir' },
  'budget.settings.clearAllowed': 'Limpar',

  'budget.usage.title': 'Orçamento',
  'budget.usage.conversation': 'Esta conversa',
  'budget.usage.day': 'Seu dia',
  'budget.usage.project': 'Projeto',
  'budget.usage.bot': 'Bot',
  'budget.usage.meter': '{pct}% do orçamento',
  'budget.usage.of': '{used} de {limit} tokens',
  'budget.usage.none': 'Hoje: {used} tokens. Sem orçamento diário ainda: Settings › Agent › Budget.',
  'budget.usage.plan': 'Janela de 5 horas do seu plano: {pct}%',
  'budget.usage.planResets': 'Janela de 5 horas do seu plano: {pct}% · reinicia {when}',

  'budget.phone.title': 'Orçamento de tokens',
  'budget.phone.of': '{used} de {limit}',
  'budget.phone.kind': 'Orçamento',
};
