import type { Message } from '../message.js';

/**
 * What the daemon says on the screens' behalf (docs/i18n.md): Needs You's titles, details and
 * buttons for team, Sentinel, dialogues, calls, friends and combos (src/companion/needs-you.ts).
 * Titles and buttons go out with their key and params (TextKey, companion 1.54). Keys start with
 * `daemon.`.
 */
export const en = {
  'daemon.needs.someone': 'Someone',
  'daemon.needs.aFriend': 'a friend',
  'daemon.needs.thePlan': 'the plan “{title}”',
  'daemon.needs.aPlan': 'a plan',
  'daemon.needs.yourPlan': 'your plan',
  'daemon.needs.names.two': '{a} and {b}',
  'daemon.needs.names.three': '{a}, {b} and {c}',
  'daemon.needs.names.more': { one: '{a}, {b} and {count} other', other: '{a}, {b} and {count} others' },

  // a friend's request to your agent (the gateway)
  'daemon.needs.wantsSecret': '{name} wants {secret}',
  'daemon.needs.saysSummary': '{name}: {summary}',
  'daemon.needs.asksAgent': '{name} asks {agent}',

  // a plan that's stuck
  'daemon.needs.stuck': 'Stuck',
  'daemon.needs.stuckOn': 'Stuck on “{title}”',
  'daemon.needs.belugaTried': 'Beluga tried: {list}',
  'daemon.needs.belugaCouldnt': 'Beluga couldn’t move it on by itself',
  'daemon.needs.mergingInto': 'merging “{title}” into {branch}',
  'daemon.needs.mergingMain': 'merging {main} into {branch} for its pull request',
  'daemon.needs.aMilestone': 'a milestone',
  'daemon.needs.thePlansBranch': 'the plan’s branch',
  'daemon.needs.whileMerging': 'While {what}: {files}',

  // someone at the door, a group's join request
  'daemon.needs.withLink': 'With your link to {label}',
  'daemon.needs.withALink': 'With one of your links',
  'daemon.needs.asksToJoin': '{name} asks to join {group}',

  // friends on the network
  'daemon.needs.friendOffer': '{name} wants to add you as a friend',
  'daemon.needs.friendOfferVia': '{name} from the {team} team wants to add you as a friend',
  'daemon.needs.friendOfferDetail': 'You’re in the same room. As friends you can talk, share and ask each other’s agents, with nobody hosting',
  'daemon.needs.accept': 'Accept',

  // a call
  'daemon.needs.calling': '{name} is calling',
  'daemon.needs.callingIn': '{name} is calling in #{group}',
  'daemon.needs.inTheCall': '{names} are in the call',
  'daemon.needs.macPicksUp': 'Your Mac picks it up when you answer',
  'daemon.needs.answerOnMac': 'Answer on Mac',

  // the team
  'daemon.needs.teamInvitedWith': '{name} invited you to the {repo} team, with {others}. Join?',
  'daemon.needs.teamWantsJoin': '{name} wants to team up on {repo}. Join?',
  'daemon.needs.teamWants': '{name} wants to team up on {repo}. Team up?',
  'daemon.needs.teamAlsoInvite': '{name} also works on {repo}: invite them to the team. Team up?',
  'daemon.needs.teamAlso': '{name} also works on {repo}. Team up?',
  'daemon.needs.teamDetail': 'Tasks, who is on which issue and the plans you choose to share stay in step. Chats and worktrees stay on your own Mac.',
  'daemon.needs.teamUp': 'Team Up',
  'daemon.needs.notNow': 'Not Now',
  'daemon.needs.gaveYou': '{by} gave you {key}: {title}',
  'daemon.needs.gaveYouDetail': 'It’s in your tasks, on your board for this repository.',
  'daemon.needs.gotIt': 'Got It',
  'daemon.needs.knocking': '{name} is knocking: they’d like to join {worktree}',
  'daemon.needs.letInEditor': 'Let In as Editor',
  'daemon.needs.letInViewer': 'Let In as Viewer',
  'daemon.needs.sharedPlan': '{owner} shared the plan “{title}”: approve it?',
  'daemon.needs.milestoneLine': { one: '{n}. {title} ({count} task)', other: '{n}. {title} ({count} tasks)' },
  'daemon.needs.comment': 'Comment',
  'daemon.needs.suggests': { one: '{name} suggests a change to “{title}”', other: '{name} suggests {count} changes to “{title}”' },
  'daemon.needs.apply': 'Apply',
  'daemon.needs.setAside': 'Set Aside',

  // Sentinel
  'daemon.needs.pullRequest': 'Pull request #{number}',
  'daemon.needs.sentinelWaits': '{name} waits for you',
  'daemon.needs.merge': 'Merge',

  // dialogues between your agents
  'daemon.needs.dialoguePaused': { one: 'Your agents paused after {count} turns: continue?', other: 'Your agents paused after {count} turns: continue?' },
  'daemon.needs.dialogueStart': 'Start this dialogue between your agents?',
  'daemon.needs.continue': 'Continue',
  'daemon.needs.stop': 'Stop',
  'daemon.needs.start': 'Start',
  'daemon.needs.cancel': 'Cancel',

  // combos
  'daemon.needs.comboOut': 'Nothing in {name} can run now',
  'daemon.needs.tryAgain': 'Try Again',
} as const satisfies Record<string, Message>;

export const ptBR: { readonly [K in keyof typeof en]?: Message } = {
  'daemon.needs.someone': 'Alguém',
  'daemon.needs.aFriend': 'um amigo',
  'daemon.needs.thePlan': 'o plano “{title}”',
  'daemon.needs.aPlan': 'um plano',
  'daemon.needs.yourPlan': 'seu plano',
  'daemon.needs.names.two': '{a} e {b}',
  'daemon.needs.names.three': '{a}, {b} e {c}',
  'daemon.needs.names.more': { one: '{a}, {b} e mais {count}', other: '{a}, {b} e mais {count}' },

  'daemon.needs.wantsSecret': '{name} quer {secret}',
  'daemon.needs.saysSummary': '{name}: {summary}',
  'daemon.needs.asksAgent': '{name} pede ao {agent}',

  'daemon.needs.stuck': 'Travado',
  'daemon.needs.stuckOn': 'Travado em “{title}”',
  'daemon.needs.belugaTried': 'O Beluga tentou: {list}',
  'daemon.needs.belugaCouldnt': 'O Beluga não conseguiu seguir sozinho',
  'daemon.needs.mergingInto': 'o merge de “{title}” em {branch}',
  'daemon.needs.mergingMain': 'o merge de {main} em {branch} para o pull request',
  'daemon.needs.aMilestone': 'uma etapa',
  'daemon.needs.thePlansBranch': 'a branch do plano',
  'daemon.needs.whileMerging': 'Durante {what}: {files}',

  'daemon.needs.withLink': 'Com o seu link para {label}',
  'daemon.needs.withALink': 'Com um dos seus links',
  'daemon.needs.asksToJoin': '{name} pede para entrar em {group}',

  'daemon.needs.friendOffer': '{name} quer adicionar você como amigo',
  'daemon.needs.friendOfferVia': '{name}, do time {team}, quer adicionar você como amigo',
  'daemon.needs.friendOfferDetail': 'Vocês estão na mesma sala. Como amigos, podem conversar, compartilhar e pedir aos agentes um do outro, sem ninguém hospedando',
  'daemon.needs.accept': 'Aceitar',

  'daemon.needs.calling': '{name} está ligando',
  'daemon.needs.callingIn': '{name} está ligando em #{group}',
  'daemon.needs.inTheCall': '{names} estão na chamada',
  'daemon.needs.macPicksUp': 'Seu Mac atende quando você responder',
  'daemon.needs.answerOnMac': 'Atender no Mac',

  'daemon.needs.teamInvitedWith': '{name} convidou você para o time de {repo}, com {others}. Entrar?',
  'daemon.needs.teamWantsJoin': '{name} quer formar um time em {repo}. Entrar?',
  'daemon.needs.teamWants': '{name} quer formar um time em {repo}. Formar time?',
  'daemon.needs.teamAlsoInvite': '{name} também trabalha em {repo}: convide para o time. Formar time?',
  'daemon.needs.teamAlso': '{name} também trabalha em {repo}. Formar time?',
  'daemon.needs.teamDetail': 'As tarefas, quem está em cada issue e os planos que você escolher compartilhar ficam em sincronia. Chats e worktrees ficam no seu próprio Mac.',
  'daemon.needs.teamUp': 'Formar time',
  'daemon.needs.notNow': 'Agora não',
  'daemon.needs.gaveYou': '{by} passou {key} para você: {title}',
  'daemon.needs.gaveYouDetail': 'Está nas suas tarefas, no seu quadro deste repositório.',
  'daemon.needs.gotIt': 'Entendi',
  'daemon.needs.knocking': '{name} está batendo: quer entrar em {worktree}',
  'daemon.needs.letInEditor': 'Deixar editar',
  'daemon.needs.letInViewer': 'Deixar ver',
  'daemon.needs.sharedPlan': '{owner} compartilhou o plano “{title}”: aprovar?',
  'daemon.needs.milestoneLine': { one: '{n}. {title} ({count} tarefa)', other: '{n}. {title} ({count} tarefas)' },
  'daemon.needs.comment': 'Comentar',
  'daemon.needs.suggests': { one: '{name} sugere uma mudança em “{title}”', other: '{name} sugere {count} mudanças em “{title}”' },
  'daemon.needs.apply': 'Aplicar',
  'daemon.needs.setAside': 'Deixar de lado',

  'daemon.needs.pullRequest': 'Pull request #{number}',
  'daemon.needs.sentinelWaits': '{name} espera por você',
  'daemon.needs.merge': 'Fazer merge',

  'daemon.needs.dialoguePaused': { one: 'Seus agentes pausaram depois de {count} turno: continuar?', other: 'Seus agentes pausaram depois de {count} turnos: continuar?' },
  'daemon.needs.dialogueStart': 'Começar este diálogo entre seus agentes?',
  'daemon.needs.continue': 'Continuar',
  'daemon.needs.stop': 'Parar',
  'daemon.needs.start': 'Começar',
  'daemon.needs.cancel': 'Cancelar',

  'daemon.needs.comboOut': 'Nada em {name} pode rodar agora',
  'daemon.needs.tryAgain': 'Tentar de novo',
};
