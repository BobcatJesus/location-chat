// InventoryPanel.jsx — the pocket / bag popup (Items + Inventory v1,
// `sq-items-inventory-v1`).
//
// Opens from the 🎒 button at the BOTTOM LEFT of the screen (never the
// toolbar — the user said the toolbar already has too many things).
// Same feel as the puzzle board zoom (PuzzleBoard.jsx): a DOM overlay
// that obscures the location for a moment; closing it returns to the
// room. Polls getState() while open (same 500ms rhythm as the quest
// HUD poll), so coins / capacity / items stay live.
//
// Props:
//   getState() — () => { items, count, capacity, hasBag, coins,
//     bagPrice, flyerCost, full, roomId, canDispose, canFeedDucks,
//     canFeedCat, decorNotice, decorNoticeSeq, hatNotice,
//     hatNoticeSeq, canHatCat } (ItemsSystem.getState)
//     — decorNotice/decorNoticeSeq are Decoration Shop v1.1
//     (`sq-dec-shop-v1-1`): the latest place/pickup news, shown in
//     this panel's own notice line when the seq changes.
//     hatNotice/hatNoticeSeq are Santa Hat v1 (`sq-santa-hat-v1`):
//     the same channel for hat news. canHatCat says whether the
//     player is standing by the cafe cat (the "Put on the cat"
//     button enables then).
//   onUse(id) / onDrop(id) / onDispose(id) — return { ok, reason? }
//   onEat(id) — Hunger System v1 (`sq-hunger-v1`): take one bite
//     of a food item (one charge = one bite, 3 bites = full for 8
//     hours). Returns { ok, notice?, reason? } — `notice` is the
//     exact bite-result line this panel shows.
//   onBuyBag() — returns { ok, reason? }
//   onMakeFlyer(title, text) — returns { ok, reason? }
//   onPinFlyer(id) — pin a flyer to this room's notice board (Notice
//     Board v1); returns { ok, pending?, reason? } — the flyer
//     leaves the pocket when the server confirms the pin
//   onPlaceDecoration(id) — place a decoration where you stand
//     (Decoration Shop v1); returns { ok, pending?, reason? } — the
//     decoration leaves the pocket when the server confirms it
//   onPutHatOnCat(id) — put the Santa hat on the cafe cat (Santa
//     Hat v1); returns { ok, pending?, reason? } — the hat leaves
//     the pocket when the server confirms it is on the cat
//   onSendMail(id, code) — send a pocket item to the player with
//     this mailbox code (Mailbox v1, `sq-mailbox-v1`); returns
//     { ok, pending?, reason? } — the item leaves the pocket only
//     when the server confirms the send. mailNotice/mailNoticeSeq
//     are the same channel for send news (timeout, unknown code,
//     full inbox) — see the decor channel above. The panel also
//     shows the player's own mailbox code (mailboxCode) and where
//     their mailbox is (mailboxRoomName).
//   onGoToMailboxRoom(roomId, roomName) — "Go to my mailbox"
//     (Mailbox v1.1, `sq-mailbox-v1.1`): close the pocket and enter
//     the mailbox room through the app-level entry (the same path as
//     tapping the room's pin on the map). The canvas supplies it;
//     the panel just calls it with the resolved mailbox room.
//   onOpenPuzzle() — close this panel and open the puzzle board
//   getBadges() — () => [{ questId, emoji, title, description,
//     completedAt, completedLabel }] (QuestManager.getCompletions,
//     Quest Badges v1) — the Badges tab
//   onClose()

import React, { useEffect, useRef, useState } from 'react';

// Mailbox v1.2 (`sq-mailbox-v1.2`): the pocket line naming where
// your mailbox(es) are — the real room name(s), never a generic
// "at the park".
// Places Sync v1 (`sq-places-sync-v1`): the mailbox key's blurb,
// naming the actual room(s) too (the static def in items.js is the
// place-less fallback for other surfaces).
import { mailboxRoomsLine, mailboxKeyBlurb } from './mailState.js';
// Feed the Ducks v2 (`sq-feed-ducks-v2`): the exact no-food wording
// for the panel's reason text.
import { NO_FOOD_MESSAGE } from './items.js';

const REASON_TEXT = {
  'inventory-full': 'Your pocket is full — use, drop, or throw something away to make room.',
  'not-enough-coins': 'Not enough coins for that yet.',
  'already-owned': 'You already have a bag.',
  'empty-flyer': 'A flyer needs a title and some text.',
  'not-usable': 'That item has no Use action.',
  // Hunger System v1 (`sq-hunger-v1`): eating when already full
  // spends nothing; only food can be eaten.
  'already-full': "You're already full — save it for later.",
  'not-food': 'Only food can be eaten.',
  'nothing-to-feed': 'No one here to feed right now — find the ducks at a pond or the cafe cat in Agora.',
  // Feed the Ducks v2 (`sq-feed-ducks-v2`): the E-key pond feed
  // refuses with this when the pocket holds no food.
  'no-food': NO_FOOD_MESSAGE,
  'cat-asleep': 'The cat is asleep — she wakes up when someone new walks in.',
  // Hungry Cat v1.2 (`sq-hungry-cat-v1.2`): the treat path refuses
  // during the cat's 5s pet cooldown instead of eating the food.
  'cat-cooldown': 'Wait a moment — she is still enjoying the last pet.',
  'not-near-trash-can': 'Walk to the Agora trash can to throw this away.',
  'not-trash': 'Only trash can be thrown away.',
  'puzzle-piece-use-board': 'Place it on the puzzle board — that frees the slot.',
  'puzzle-piece-no-drop': 'Puzzle pieces can’t be dropped — place them on the puzzle board.',
  'not-flyer': 'Only flyers can be pinned to the notice board.',
  'not-decoration': 'Only decorations can be placed like that.',
  'not-hat': 'Only the Santa hat goes on the cat.',
  'not-near-cat': 'Walk up to the cat to put the hat on her.',
  'santa-hat-no-drop': 'The Santa hat belongs on the cat — put it on her instead of dropping it.',
  // Mailbox v1 (`sq-mailbox-v1`): the key can never be dropped
  // (dropping it would lock you out of your own mail); puzzle
  // pieces and the Santa hat can never be sent (round-scoped /
  // one-per-room server state). The last three arrive via the mail
  // notice channel too (MailSystem._sendReasonText) — they are
  // listed here so a direct send path shows the same words.
  'mailbox-key-no-drop': 'You can’t drop your mailbox key — you’d lock yourself out of your own mail.',
  'not-sendable': 'That can’t be sent by mail — puzzle pieces, the Santa hat, your mailbox key and gift wrapping paper stay with you.',
  // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): sending costs one
  // sheet of wrapping paper. 'no-paper' is the client-side check
  // (pocket empty); 'not-wrapped' is the server's flag check.
  'no-paper': 'You need gift wrapping paper to send a gift — buy some at the Agora bar.',
  'not-wrapped': 'That gift needs wrapping paper — buy some at the Agora bar.',
  'bad-code': 'That doesn’t look like a mailbox code — it’s 5 letters.',
  'unknown-code': 'No mailbox with that code — check it and try again.',
  'self-send': 'That’s your own code — send it to a friend instead.',
  'inbox-full': 'Their mailbox is full — try again later.',
  'rate-limited': 'You’re sending too fast — try again in a bit.',
  'room-full': 'This room is full of decorations — pick one up first.',
  'not-yours': 'That decoration belongs to someone else — only they can move it.',
  // Decoration Shop v1.1 (`sq-dec-shop-v1-1`): placing (or taking
  // back) before the server has confirmed the room join.
  'not-joined': 'Still connecting to the room — try again in a second.',
  offline: 'You seem to be offline — try again when you’re connected.',
  'not-available': 'The notice board is only in Agora.',
  'not-found': 'That item is no longer in your pocket.',
  error: 'Something went wrong — try again.',
};

export default function InventoryPanel({
  getState, onUse, onEat, onDrop, onDispose, onBuyBag, onMakeFlyer, onPinFlyer, onPlaceDecoration, onPutHatOnCat, onSendMail, onGoToMailboxRoom, onOpenPuzzle, getBadges, onClose,
}) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  // Quest badges v1: second tab, next to the items — your finished
  // quests, newest first. Coffee purchases are steps, not badges:
  // only a completed quest earns its badge.
  const [tab, setTab] = useState('items');
  const [badges, setBadges] = useState(() => {
    try { return getBadges ? getBadges() : []; } catch { return []; }
  });
  const [notice, setNotice] = useState('');
  // Decoration Shop v1.1 (`sq-dec-shop-v1-1`): the seq of the last
  // decor notice this panel already showed. The panel polls
  // getState() every 500ms; when DecorSystem posts fresh place /
  // pickup news (a timeout, or a late confirm) the seq changes and
  // the panel copies it into its own notice line — the scene toast
  // is hidden under this panel, so this is the only place the
  // player will see it while the pocket is open.
  const lastDecorNoticeSeqRef = useRef(0);
  // Santa Hat v1 (`sq-santa-hat-v1`): same channel for hat news.
  const lastHatNoticeSeqRef = useRef(0);
  // Mailbox v1 (`sq-mailbox-v1`): same channel for mail news (a
  // send that timed out, an unknown code, a full inbox).
  const lastMailNoticeSeqRef = useRef(0);
  const [reader, setReader] = useState(null); // item being read, or null
  const [flyerTitle, setFlyerTitle] = useState('');
  const [flyerText, setFlyerText] = useState('');
  const [showFlyerForm, setShowFlyerForm] = useState(false);
  // Mailbox v1 (`sq-mailbox-v1`): which item is being sent, and the
  // recipient's code typed so far.
  const [sendTarget, setSendTarget] = useState(null);
  const [sendCode, setSendCode] = useState('');
  // Mailbox v1.2 (`sq-mailbox-v1.2`, decision 2): the pocket line
  // naming where your mailbox(es) are — one room ("Your mailbox is
  // at Shepherd Park") or both ("Your mailboxes are at Shepherd
  // Park and Your Place 2"). Falls back to the single nearest
  // room's name when the list itself is empty.
  const mailboxLine = state ? mailboxRoomsLine(state.mailboxRooms, state.mailboxRoomName) : '';
  // Places Sync v1 (`sq-places-sync-v1`): the mailbox key's blurb
  // names the same real room(s) as the pocket line — the static
  // "at the park" text is gone. Unresolved yet: the place-less
  // version, never a generic "at the park".
  const mailboxKeyBlurbText = state ? mailboxKeyBlurb(state.mailboxRooms, state.mailboxRoomName) : '';

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) {
          setState(next);
          // Decoration Shop v1.1: a fresh decor notice (timeout or
          // late confirm) replaces the stale "Placing it…" line.
          // The seq check keeps the poll from stomping a newer
          // notice an action just set via run().
          if (typeof next.decorNoticeSeq === 'number'
            && next.decorNoticeSeq !== lastDecorNoticeSeqRef.current) {
            lastDecorNoticeSeqRef.current = next.decorNoticeSeq;
            if (next.decorNotice) setNotice(next.decorNotice);
          }
          // Santa Hat v1: same channel for hat news (timeout, or a
          // late confirm that the hat is on the cat / back in hand).
          if (typeof next.hatNoticeSeq === 'number'
            && next.hatNoticeSeq !== lastHatNoticeSeqRef.current) {
            lastHatNoticeSeqRef.current = next.hatNoticeSeq;
            if (next.hatNotice) setNotice(next.hatNotice);
          }
          // Mailbox v1: same channel for mail news (a send that
          // timed out, an unknown code, a full inbox, or a send
          // that landed — the item leaving the pocket is visible
          // in the list, but the words confirm it went through).
          if (typeof next.mailNoticeSeq === 'number'
            && next.mailNoticeSeq !== lastMailNoticeSeqRef.current) {
            lastMailNoticeSeqRef.current = next.mailNoticeSeq;
            if (next.mailNotice) setNotice(next.mailNotice);
          }
        }
      } catch {}
      try {
        const nextBadges = getBadges ? getBadges() : null;
        if (Array.isArray(nextBadges)) setBadges(nextBadges);
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getState, getBadges]);

  const refresh = () => {
    try {
      const next = getState ? getState() : null;
      if (next) setState(next);
    } catch {}
  };

  const run = (fn, okText) => {
    let res = { ok: false, reason: 'error' };
    try { res = fn ? fn() : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      // Hunger System v1 (`sq-hunger-v1`): the Eat button passes a
      // function, so the notice line shows the bite's own result
      // ("Still hungry... eat more." / "😋 Ahhh... full for most
      // of the day." / the queasy line) instead of a fixed word.
      setNotice(typeof okText === 'function' ? okText(res) : (okText || ''));
      refresh();
      return true;
    }
    setNotice(REASON_TEXT[res?.reason] || REASON_TEXT.error);
    refresh();
    return false;
  };

  if (!state) return null;
  const items = state.items || [];

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 1100,
        background: 'rgba(15,23,42,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff7e6', color: '#1a4971', borderRadius: 12,
          padding: 16, width: 'min(420px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: 18 }}>
            🎒 {state.hasBag ? 'Your Bag' : 'Your Pocket'}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid #1a4971', borderRadius: 6,
              color: '#1a4971', cursor: 'pointer', fontSize: 14, padding: '4px 10px',
            }}
          >
            Close ✕
          </button>
        </div>
        <div style={{ fontSize: 13, marginTop: 4, color: '#3d6a8a' }}>
          {state.count}/{state.capacity} items · 🪙 {state.coins} coins
          {state.full ? ' · Pocket full!' : ''}
        </div>
        {/* Mailbox v1 (`sq-mailbox-v1`): your own mailbox code, so
            you can share it with a friend in the room — it is a
            game number, it means nothing in the real world. The
            line also names where your mailbox is. Mailbox v1.2
            (`sq-mailbox-v1.2`, decision 2): with two mailboxes it
            names BOTH rooms ("Your mailboxes are at Shepherd Park
            and Your Place 2") — the real room names, never a
            generic "at the park". It also says when you have mail
            waiting. */}
        {state.mailboxCode && (
          <div style={{ fontSize: 13, marginTop: 4, color: '#3d6a8a' }}>
            📬 My mailbox code: <b style={{ letterSpacing: 2 }}>{state.mailboxCode}</b>
            {mailboxLine ? ` · ${mailboxLine}` : ''}
            {state.mailUnread > 0 ? ` · You’ve got mail (${state.mailUnread})!` : ''}
          </div>
        )}
        {/* Mailbox v1.1 (`sq-mailbox-v1.1`): "Go to my mailbox" —
            next to the code line. Only when the mailbox room is
            resolved (mailboxRoomId + mailboxRoomName — v1.1 resolves
            them from any room; v1 left them blank outside the
            mailbox room) and you are not already standing in it
            (tapping it there would just remount the same room).
            The click closes the pocket and enters the room through
            the app-level entry — the same path as tapping the
            room's pin on the map — via onGoToMailboxRoom.
            Mailbox v1.2 (`sq-mailbox-v1.2`, decision 3): the target
            is the NEAREST of the player's mailbox rooms (the
            mailboxRoomId / mailboxRoomName in state are the
            nearest); the button hides when you are already in ANY
            of your mailbox rooms (isMailboxRoom). */}
        {state.mailboxRoomId && state.mailboxRoomName && !state.isMailboxRoom && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => onGoToMailboxRoom?.(state.mailboxRoomId, state.mailboxRoomName)}
              title={`Go to ${state.mailboxRoomName} — your mailbox is there`}
              style={btnStyle}
            >
              📬 Go to my mailbox
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button
            onClick={() => setTab('items')}
            style={{
              ...btnStyle,
              background: tab === 'items' ? '#1a4971' : 'transparent',
              color: tab === 'items' ? '#fff' : '#1a4971',
              border: tab === 'items' ? 'none' : '1px solid #1a4971',
            }}
          >
            🎒 Pocket
          </button>
          <button
            onClick={() => setTab('badges')}
            style={{
              ...btnStyle,
              background: tab === 'badges' ? '#1a4971' : 'transparent',
              color: tab === 'badges' ? '#fff' : '#1a4971',
              border: tab === 'badges' ? 'none' : '1px solid #1a4971',
            }}
          >
            🏅 Badges ({badges.length})
          </button>
        </div>

        {tab === 'badges' ? (
          <div style={{ marginTop: 12 }}>
            {badges.length === 0 ? (
              <div style={{ fontSize: 13, color: '#3d6a8a' }}>
                No badges yet. Finish a quest and its badge shows up
                here — and other players can see it when they click
                on you.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {badges.map((badge) => (
                  <div
                    key={badge.questId}
                    style={{
                      border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                      background: '#fffdf5',
                    }}
                  >
                    <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                      {badge.emoji} {badge.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                      {badge.description}
                    </div>
                    <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                      Finished {badge.completedLabel || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
              One badge per finished quest — coffee buys and other
              quest steps don’t earn badges, only completing the
              quest does.
            </div>
          </div>
        ) : reader ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 'bold', fontSize: 15 }}>
              {reader.emoji} {reader.title || reader.label}
            </div>
            <div style={{
              marginTop: 8, padding: 12, borderRadius: 8, background: '#fffdf5',
              border: '1px solid #e2b46c', fontSize: 14, lineHeight: 1.5,
              whiteSpace: 'pre-line', color: '#3d2c14',
            }}>
              {reader.text}
            </div>
            <button
              onClick={() => setReader(null)}
              style={{
                marginTop: 10, background: '#1a4971', color: '#fff', border: 'none',
                borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13,
              }}
            >
              ← Back to your pocket
            </button>
          </div>
        ) : (
          <>
            {items.length === 0 ? (
              <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
                Nothing in here yet. Click on furniture a few times around
                Agora — trash cans, tables, plants — and things turn up.
                Bits of food and litter on the floor can be picked up with
                one click when you walk up to them.
              </div>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                      background: '#fffdf5',
                    }}
                  >
                    <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                      {item.emoji} {item.title || item.label}
                      {item.type === 'puzzle-piece' && item.pieceId != null
                        ? ` (#${item.pieceId + 1})` : ''}
                      {/* Feed the Ducks v2 (`sq-feed-ducks-v2`): a
                          bits of food shows its remaining feeds. */}
                      {item.type === 'food' && item.usesLeft != null
                        ? ` · ${item.usesLeft} ${item.usesLeft === 1 ? 'feed' : 'feeds'} left` : ''}
                      {/* Gift Wrapping Paper v1 (`sq-gift-wrap-v1`):
                          a stack shows its sheet count, like food
                          shows feeds. */}
                      {item.type === 'wrapping-paper' && item.sheetsLeft != null
                        ? ` · ${item.sheetsLeft} ${item.sheetsLeft === 1 ? 'sheet' : 'sheets'}` : ''}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                      {/* Places Sync v1 (`sq-places-sync-v1`): the
                          mailbox key's blurb names the real room(s)
                          — the static "at the park" text is gone. */}
                      {item.type === 'mailbox-key' && mailboxKeyBlurbText ? mailboxKeyBlurbText : item.blurb}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {item.readable && (
                        <button
                          onClick={() => setReader(item)}
                          style={btnStyle}
                        >
                          Read
                        </button>
                      )}
                      {item.usable && (
                        <button
                          onClick={() => run(() => onUse && onUse(item.id), 'Used!')}
                          style={btnStyle}
                        >
                          Use 🍽️
                        </button>
                      )}
                      {/* Hunger System v1 (`sq-hunger-v1`): a
                          separate Eat button on food — one bite per
                          tap (one charge), 3 bites and you're full
                          for 8 hours. It never feeds the ducks or
                          the cat; that is what Use is for. */}
                      {item.type === 'food' && (
                        <button
                          onClick={() => run(
                            () => onEat && onEat(item.id),
                            (res) => (res && res.notice) || 'Nom!',
                          )}
                          title="Take a bite — one bite per tap, 3 bites and you're full for most of the day. Food from the ground works too, but it might make you queasy."
                          style={btnStyle}
                        >
                          Eat 😋
                        </button>
                      )}
                      {item.type === 'puzzle-piece' && (
                        <button
                          onClick={() => { if (onOpenPuzzle) onOpenPuzzle(); }}
                          style={btnStyle}
                        >
                          Open puzzle board 🧩
                        </button>
                      )}
                      {item.type === 'flyer' && (
                        <button
                          onClick={() => run(
                            () => onPinFlyer && onPinFlyer(item.id),
                            '📌 Pinning it to the notice board…',
                          )}
                          title="Pin this flyer to this room's notice board so everyone here can read it — it leaves your pocket once the board confirms it"
                          style={btnStyle}
                        >
                          Pin to board 📌
                        </button>
                      )}
                      {item.type === 'decoration' && (
                        <button
                          onClick={() => run(
                            () => onPlaceDecoration && onPlaceDecoration(item.id),
                            '🎄 Placing it where you stand…',
                          )}
                          title="Place this decoration where you're standing — everyone in the room will see it. It leaves your pocket once the room confirms it"
                          style={btnStyle}
                        >
                          Place 🎄
                        </button>
                      )}
                      {item.type === 'santa-hat' && (
                        <button
                          onClick={() => run(
                            () => onPutHatOnCat && onPutHatOnCat(item.id),
                            '🎅 Putting the hat on the cat…',
                          )}
                          disabled={!state.canHatCat}
                          title={state.canHatCat ? 'Put the Santa hat on the cafe cat — she’ll wear it until it slips off' : 'Walk up to the cafe cat to put the hat on her'}
                          style={{
                            ...btnStyle,
                            opacity: state.canHatCat ? 1 : 0.55,
                            cursor: state.canHatCat ? 'pointer' : 'not-allowed',
                          }}
                        >
                          Put on the cat 🎅
                        </button>
                      )}
                      {item.disposable && (
                        <button
                          onClick={() => run(() => onDispose && onDispose(item.id), '🗑️ Tossed! The cafe stays tidy.')}
                          disabled={!state.canDispose}
                          title={state.canDispose ? 'Throw this away in the Agora trash can' : 'Walk to the Agora trash can to throw this away'}
                          style={{ ...btnStyle, opacity: state.canDispose ? 1 : 0.55, cursor: state.canDispose ? 'pointer' : 'not-allowed' }}
                        >
                          Throw away 🗑️
                        </button>
                      )}
                      {item.type !== 'puzzle-piece' && item.type !== 'santa-hat' && (
                        <button
                          onClick={() => run(
                            () => onDrop && onDrop(item.id),
                            // Drop on the home floor v1: at home the
                            // drop lands on your floor and stays
                            // there; anywhere else it is ground
                            // litter for this session.
                            state.atHome ? 'Dropped on the floor of your home.' : 'Dropped on the ground here.',
                          )}
                          title={state.atHome ? 'Drop this on the floor of your home — it stays there until you pick it back up' : 'Drop this on the ground here'}
                          // sq-drop-label-fix-v1 — Drop used to keep btnStyle's
                          // white text with a transparent background, so the
                          // label was invisible on the light card. It now
                          // uses the plain shared button style (dark blue).
                          style={btnStyle}
                        >
                          Drop
                        </button>
                      )}
                      {/* Mailbox v1 (`sq-mailbox-v1`): send this to a
                          friend's mailbox — they pick it up at their
                          nearest park. Puzzle pieces and the Santa
                          hat can't be sent (round-scoped /
                          one-per-room server state), and the mailbox
                          key can't be sent either (it's the key to
                          your own mail). Gift Wrapping Paper v1
                          (`sq-gift-wrap-v1`): wrapping paper can't
                          be sent either — it is the supply, not a
                          gift. */}
                      {item.type !== 'puzzle-piece' && item.type !== 'santa-hat' && item.type !== 'mailbox-key' && item.type !== 'wrapping-paper' && sendTarget?.id !== item.id && (
                        <button
                          onClick={() => { setSendTarget(item); setSendCode(''); setNotice(''); }}
                          title="Send this to a friend's mailbox — type their 5-letter mailbox code. It leaves your pocket once their mailbox confirms it"
                          style={btnStyle}
                        >
                          Send ✉️
                        </button>
                      )}
                    </div>
                    {sendTarget?.id === item.id && (
                      <div style={{
                        marginTop: 8, padding: 10, borderRadius: 8,
                        background: '#eff6ff', border: '1px solid #93c5fd',
                      }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>✉️ Send to a mailbox</div>
                        <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                          Type their 5-letter mailbox code — a game
                          code, nothing real. It leaves your pocket
                          once their mailbox confirms it. Sending
                          uses one sheet of gift wrapping paper —
                          buy some at the Agora bar if you&apos;re out.
                        </div>
                        <input
                          value={sendCode}
                          onChange={(e) => setSendCode(e.target.value.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g, '').slice(0, 5))}
                          placeholder="Mailbox code (5 letters)"
                          maxLength={5}
                          style={{ ...inputStyle, letterSpacing: 2, textTransform: 'uppercase' }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button
                            onClick={() => {
                              const ok = run(
                                () => onSendMail && onSendMail(item.id, sendCode),
                                '📬 Sending it…',
                              );
                              if (ok) { setSendTarget(null); setSendCode(''); }
                            }}
                            disabled={sendCode.trim().length !== 5}
                            title={sendCode.trim().length === 5 ? 'Send this to their mailbox' : 'Type all 5 letters of their mailbox code first'}
                            style={{
                              ...btnStyle,
                              opacity: sendCode.trim().length === 5 ? 1 : 0.55,
                              cursor: sendCode.trim().length === 5 ? 'pointer' : 'not-allowed',
                            }}
                          >
                            Send ✉️
                          </button>
                          <button
                            onClick={() => { setSendTarget(null); setSendCode(''); setNotice(''); }}
                            style={{ ...btnStyle, background: 'transparent' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {item.type === 'puzzle-piece' && (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                        Placing it on the puzzle board frees this slot.
                      </div>
                    )}
                    {item.type === 'decoration' && (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                        Placing it where you stand frees this slot — everyone in the room will see it.
                      </div>
                    )}
                    {item.type === 'santa-hat' && (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                        Put it on the cat — she’ll wear it until it slips off.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {notice && (
              <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
            )}

            {!state.hasBag && (
              <div style={{
                marginTop: 14, padding: 10, borderRadius: 8, background: '#fef3c7',
                border: '1px solid #f59e0b',
              }}>
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>🎒 Upgrade to a bag</div>
                <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 2 }}>
                  A purse or backpack holds 10 items instead of 3 — and it
                  shows on your avatar for everyone to see.
                </div>
                <button
                  onClick={() => run(() => onBuyBag && onBuyBag(), '🎒 You got a bag! Now holds 10 items.')}
                  disabled={state.coins < state.bagPrice}
                  title={state.coins < state.bagPrice ? `Need ${state.bagPrice} coins` : `Buy a bag for ${state.bagPrice} coins`}
                  style={{
                    ...btnStyle, marginTop: 8,
                    opacity: state.coins < state.bagPrice ? 0.55 : 1,
                    cursor: state.coins < state.bagPrice ? 'not-allowed' : 'pointer',
                  }}
                >
                  Buy a bag · {state.bagPrice} 🪙
                </button>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              {!showFlyerForm ? (
                <button
                  onClick={() => setShowFlyerForm(true)}
                  disabled={state.full}
                  title={state.full ? 'Your pocket is full — make room first' : `Make a flyer for ${state.flyerCost} coins`}
                  style={{
                    ...btnStyle,
                    opacity: state.full ? 0.55 : 1,
                    cursor: state.full ? 'not-allowed' : 'pointer',
                  }}
                >
                  📄 Make a flyer · {state.flyerCost} 🪙
                </button>
              ) : (
                <div style={{
                  padding: 10, borderRadius: 8, background: '#fffdf5',
                  border: '1px solid #e2b46c',
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>📄 Make a flyer</div>
                  <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                    {state.flyerCost} coins. The flyer goes into your pocket —
                    read it, drop it here for someone to stumble on, or pin
                    it to the notice board in Agora for everyone to see.
                  </div>
                  <input
                    value={flyerTitle}
                    onChange={(e) => setFlyerTitle(e.target.value)}
                    placeholder="Flyer title (e.g. Guitar lessons!)"
                    maxLength={60}
                    style={inputStyle}
                  />
                  <textarea
                    value={flyerText}
                    onChange={(e) => setFlyerText(e.target.value)}
                    placeholder="What should the flyer say?"
                    maxLength={200}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => {
                        const ok = run(
                          () => onMakeFlyer && onMakeFlyer(flyerTitle, flyerText),
                          '📄 Flyer made — it’s in your pocket!',
                        );
                        if (ok) { setFlyerTitle(''); setFlyerText(''); setShowFlyerForm(false); }
                      }}
                      style={btnStyle}
                    >
                      Make it · {state.flyerCost} 🪙
                    </button>
                    <button
                      onClick={() => { setShowFlyerForm(false); setNotice(''); }}
                      style={{ ...btnStyle, background: 'transparent' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
              Tip: puzzle pieces live here too — each one takes a slot
              until you place it on the puzzle board.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '7px 10px',
  border: '1px solid #94a3b8', borderRadius: 6, fontSize: 13,
  fontFamily: 'inherit', background: '#fff', color: '#1a4971',
};
