import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { Avatar, Button } from '../components/ui.js';
import type { PopupPort } from '../gateway/popup-bridge.js';
import { POPUP_MAX, type PopupItem, type PopupNeed, type PopupRequest, isNeed, popupButtons, popupWho } from '../gateway/popup-model.js';
import type { RequestAction } from '../gateway/request-actions.js';
import s from './popup.module.css';
import { useT } from '../lib/i18n.js';

/**
 * A friend's request, on top of whatever you're doing: who, a few words of what they want,
 * and Allow / Allow Always / Decline. See more shows everything their Claude sent (the full
 * ask, what it needs, where it runs, what goes back) before you answer.
 */

const KIND_ICON = { ask: 'claude', run: 'terminal', file: 'file' } as const;
const NEED_ICON = { question: 'claude', decision: 'hand', plan: 'wand', approval: 'lock', milestone: 'flag' } as const;
const NEED_LEAD = { question: 'sidebar.popup.lead.question', decision: 'sidebar.popup.lead.decision', plan: 'sidebar.popup.lead.plan', approval: 'sidebar.popup.lead.approval', milestone: 'sidebar.popup.lead.milestone' } as const;

/**
 * Your own Claude (or a plan) needs you: what, where, and Open, which takes you there in Beluga
 * (a question's choices, your own words, the decision's card: there's room for them there).
 */
function NeedCard({ r, open, later }: { r: PopupNeed; open: () => void; later: () => void }) {
  const t = useT();
  return (
    <article className={s.card} data-testid="request-popup-card" data-need={r.tag} aria-label={`${r.title}: ${r.body}`}>
      <header className={s.head}>
        <span className={s.needMark} aria-hidden>
          <Icon name={NEED_ICON[r.tag]} size={15} />
        </span>
        <div className={s.headText}>
          <div className={s.who}>
            <strong>{t(NEED_LEAD[r.tag])}</strong> · {r.title}
          </div>
          <button type="button" className={s.needBody} onClick={open}>
            {r.body}
          </button>
          {r.options?.length ? <div className={s.said}>{r.options.join(' · ')}</div> : null}
        </div>
      </header>
      <footer className={s.buttons}>
        <Button size="small" variant="plain" onClick={later}>
          {t('sidebar.later')}
        </Button>
        <Button size="small" variant="primary" onClick={open}>
          {r.tag === 'approval' ? t('sidebar.popup.reviewInBeluga') : r.tag === 'milestone' ? t('sidebar.popup.openPlan') : t('sidebar.popup.answerInBeluga')}
        </Button>
      </footer>
    </article>
  );
}

function Card({ r, act }: { r: PopupRequest; act: (action: RequestAction, r: PopupRequest) => void }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const press = (action: RequestAction): void => {
    if (action === 'review') return act(action, r);
    setBusy(true);
    act(action, r);
    // Answered, the card goes; if it couldn't be (Beluga says why), the buttons come back.
    setTimeout(() => setBusy(false), 4000);
  };
  return (
    <article className={s.card} data-testid="request-popup-card" aria-label={r.secret ? t('sidebar.popup.whoWants', { who: popupWho(r), what: r.secret }) : t('sidebar.popup.whoWantsTo', { who: popupWho(r), what: r.gist })}>
      <header className={s.head}>
        <Avatar name={r.peerName} id={r.peerId} claude={r.claude} size={30} />
        <div className={s.headText}>
          <div className={s.who}>
            <strong>{popupWho(r)}</strong> {r.secret ? t('sidebar.popup.wants') : t('sidebar.popup.wantsTo')}
          </div>
          <div className={s.gist}>
            <Icon name={r.secret ? 'lock' : KIND_ICON[r.kind]} size={13} />
            <span>{r.secret ?? r.gist}</span>
          </div>
          {r.secret ? <div className={s.said}>{t('sidebar.popup.secretNote')}</div> : null}
          {r.said ? <div className={s.said}>{r.said}</div> : null}
        </div>
      </header>
      {r.needs.length ? (
        <div className={s.needs}>
          {r.needs.map((n) => (
            <span key={n} className={s.need}>
              {n}
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" className={s.more} aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name={more ? 'chevronDown' : 'chevronRight'} size={11} />
        {more ? t('sidebar.popup.seeLess') : t('sidebar.popup.seeMore')}
      </button>
      {more ? (
        <div className={s.detail} data-testid="request-popup-detail">
          <div className={s.label}>{r.kind === 'ask' ? t('sidebar.popup.whatSends', { who: popupWho(r) }) : r.kind === 'run' ? t('sidebar.popup.theCommand') : t('sidebar.popup.theFile')}</div>
          <pre className={s.full}>{r.full}</pre>
          <dl className={s.facts}>
            <dt>{t('sidebar.popup.where')}</dt>
            <dd>{r.where}</dd>
            <dt>{t('sidebar.popup.sendsBack')}</dt>
            <dd>{r.back}</dd>
          </dl>
          <button type="button" className={s.link} onClick={() => press('review')}>
            {t('sidebar.popup.moreChoices')}
          </button>
        </div>
      ) : null}
      <footer className={s.buttons}>
        {popupButtons(r).map((b) => (
          <Button key={b.action} size="small" variant={b.action === 'approve' ? 'primary' : 'plain'} disabled={busy} onClick={() => press(b.action)}>
            {b.label}
          </Button>
        ))}
      </footer>
    </article>
  );
}

export function RequestPopup({ port }: { port: PopupPort }) {
  const t = useT();
  const [requests, setRequests] = useState<readonly PopupItem[]>([]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => port.subscribe(setRequests), [port]);
  // The window is as tall as the cards.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const report = (): void => port.resize(Math.ceil(el.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [port, requests]);
  const shown = requests.slice(0, POPUP_MAX);
  const rest = requests.length - shown.length;
  if (!shown.length) return null;
  return (
    <div ref={root} className={s.stack} role="dialog" aria-label={requests.some(isNeed) ? t('sidebar.notifications.waitingForYou') : t('sidebar.popup.fromFriends')}>
      <button type="button" className={s.close} aria-label={t('sidebar.popup.hide')} title={t('sidebar.popup.hide')} onClick={() => port.dismiss(requests.map((r) => r.approval))}>
        <Icon name="x" size={10} />
      </button>
      {shown.map((r) =>
        isNeed(r) ? (
          <NeedCard key={r.approval} r={r} open={() => port.act('review', r)} later={() => port.dismiss([r.approval])} />
        ) : (
          <Card key={r.approval} r={r} act={(action, req) => port.act(action, req)} />
        ),
      )}
      {rest > 0 ? (
        <button type="button" className={s.rest} onClick={() => port.act('review', { approval: '', task: '' })}>
          {t('sidebar.popup.moreWaiting', { count: rest })}
        </button>
      ) : null}
    </div>
  );
}
