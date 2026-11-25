// GiftSystem.js — the direct-give side of Gift Giver
// (`sq-gift-giver-v1`).
//
// Owned by VillageScene, same shape as MailSystem: constructed in
// create(), destroyed in shutdown(). The mailbox covers gifts sent
// to a code; this covers gifts handed to someone standing in the
// same room — click the player, pick an item, they accept or
// decline.
//
// THE HANDSHAKE (server relays, clients hold the inventory — the
// same trust boundary as mail and coins):
//   1. Giver offers: client checks (online, not self, item is
//      sendable, one sheet of wrapping paper held) and emits
//      `gift_offer` { offerId, toSocketId, item, fromName,
//      wrapped: true }. The server validates (same room, not self,
//      cleanMailItem, wrapped flag) and relays `gift_offered` to
//      the recipient. The item STAYS in the giver's pocket until
//      the recipient confirms receipt — a decline, a timeout, or a
//      full pocket on their side leaves everything with the giver.
//   2. Recipient accepts (`gift_accept`) or declines
//      (`gift_decline`). Accepting checks their pocket has room
//      first — a full pocket auto-declines instead of eating the
//      gift. The server hands them the gift (`gift_received`).
//   3. Recipient confirms receipt (`gift_received_confirm`) once
//      the item is in their pocket — only then does the giver
//      remove the item, spend the sheet, and count the gift toward
//      the Gift Giver quest. If the add fails (pocket filled in
//      another tab), the recipient sends `gift_receive_failed` and
//      the giver keeps everything.
//   4. Offers die after 60s (the giver's client cancels, the
//      server sweeps) or when either side disconnects — the other
//      side's prompt/pending state just closes, silently.
//
// A gift is always wrapped: the offer requires one sheet of gift
// wrapping paper (2 coins a sheet at the Agora bar), spent only on
// the recipient's confirm — never on offer, decline, or expiry.
// The refusal text is the mail one, word for word.

import {
  ITEM_TYPES,
  getItem,
  removeItem,
  addItem,
  canAddItem,
  getInventoryState,
  hasWrappingPaper,
  spendWrappingSheet,
} from './items.js';
import { cleanMailItem, isSendableItemType } from './mailState.js';

// Gift Giver v1 (`sq-gift-giver-v1`): the quest event the
// Gift Giver quest counts (see quests.js). Mailed gifts count on
// the mail send confirm (MailSystem); direct gifts count here,
// on the recipient's confirm.
export const GIFT_GIVEN_EVENT = 'gift-given';

// How long an unanswered offer lives (ms) — matches the server's
// GIFT_OFFER_TTL_MS. The giver's client cancels at the same age,
// so a stale offer never sits pending forever.
const GIFT_OFFER_TTL_MS = 60000;

// The refusal text for a direct gift with no paper — the mail one,
// word for word (see InventoryPanel REASON_TEXT 'no-paper' and
// MailSystem._sendReasonText). Same words on both give paths.
export const NO_PAPER_TEXT = 'You need gift wrapping paper to send a gift — buy some at the Agora bar.';

export class GiftSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-gift-giver-v1 — marker for the landing check (live
    // reference, so the string survives minification into the
    // built bundle).
    this.marker = 'sq-gift-giver-v1';
    this._pendingOutgoing = null; // { offerId, toSocketId, itemId, itemLabel, timer }
    this._incoming = null; // { offerId, fromSocketId, fromName, item: { type, label, emoji } }
    this._incomingQueue = []; // offers that arrived while one is showing
  }

  get enabled() {
    return Boolean(this.scene?.roomId);
  }

  /** Sendable pocket items for the give picker: everything the
   *  mailbox would send (same rules — puzzle pieces, the Santa
   *  hat, the mailbox key and wrapping paper stay with you). */
  getSendableItems() {
    try {
      const items = getInventoryState().items || [];
      return items.filter((it) => isSendableItemType(it?.type));
    } catch { return []; }
  }

  /** Is an offer out to this player right now? (The player panel
   *  polls this to show "Offer sent — waiting for them…") */
  isOfferPendingTo(socketId) {
    return Boolean(this._pendingOutgoing && this._pendingOutgoing.toSocketId === String(socketId || ''));
  }

  /** Plain-data state for the DOM: the live incoming offer, or null. */
  getIncomingOffer() {
    return this._incoming ? { ...this._incoming, item: { ...this._incoming.item } } : null;
  }

  // ---- offering ------------------------------------------------------

  /** Offer a pocket item to another player in this room. The item
   *  stays in your pocket until they confirm receipt — a decline
   *  or an expiry costs nothing. Returns { ok, pending?, reason? }.
   *  Reasons: 'not-available', 'offline', 'self-give',
   *  'not-found', 'not-sendable', 'no-paper', 'already-pending',
   *  'error'. */
  offerGift(toSocketId, itemId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const to = String(toSocketId || '').trim();
    if (!to) return { ok: false, reason: 'not-found' };
    if (to === this.scene.socket.id) return { ok: false, reason: 'self-give' };
    if (this._pendingOutgoing) return { ok: false, reason: 'already-pending' };
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: 'not-found' };
    const cleaned = cleanMailItem(item);
    if (!cleaned) return { ok: false, reason: 'not-sendable' };
    // sq-gift-giver-v1 — no paper, no offer: refuse before any
    // emit, so a refused offer costs nothing (no sheet, no item).
    if (!hasWrappingPaper()) return { ok: false, reason: 'no-paper' };
    const offerId = `gift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const fromName = this._displayName();
    this._pendingOutgoing = {
      offerId,
      toSocketId: to,
      itemId: item.id,
      itemLabel: item.label || 'a gift',
      timer: setTimeout(() => {
        // Unanswered for 60s: cancel silently — the server drops
        // the offer and closes the recipient's prompt too.
        if (!this._pendingOutgoing || this._pendingOutgoing.offerId !== offerId) return;
        this._pendingOutgoing = null;
        try {
          this.scene.socket.emit('gift_cancel', { roomId: this.scene.roomId, offerId });
        } catch {}
      }, GIFT_OFFER_TTL_MS),
    };
    try {
      this.scene.socket.emit('gift_offer', {
        roomId: this.scene.roomId,
        offerId,
        toSocketId: to,
        item: { ...cleaned, emoji: item.emoji || null },
        fromName,
        // sq-gift-giver-v1 — the server refuses any offer without
        // this flag ('not-wrapped'); a gift never travels unwrapped.
        wrapped: true,
      });
    } catch {
      this._clearOutgoing();
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true, offerId };
  }

  /** The server answered my offer: ok → it is live with the
   *  recipient; fail → nothing was offered, clear the pending
   *  state and say why. */
  onOfferResult(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!this._pendingOutgoing || this._pendingOutgoing.offerId !== offerId) return;
    if (payload.ok) return; // live — the recipient decides now
    this._clearOutgoing();
    try { this.scene?.onSystemNotice?.(this._offerReasonText(payload.reason)); } catch {}
  }

  _offerReasonText(reason) {
    switch (reason) {
      case 'self-give': return 'That’s yourself — give it to a friend instead.';
      case 'not-in-room': return 'They left the room — try again when you’re together.';
      case 'not-sendable': return 'That can’t be given away — puzzle pieces, the Santa hat, your mailbox key and gift wrapping paper stay with you.';
      case 'no-paper': return NO_PAPER_TEXT;
      case 'not-wrapped': return 'That gift needs wrapping paper — buy some at the Agora bar.';
      case 'rate-limited': return 'You’re offering too fast — try again in a bit.';
      default: return 'Something went wrong — try again.';
    }
  }

  // ---- receiving -------------------------------------------------------

  /** A gift offer arrived: show it (or queue it behind the one
   *  already showing). The prompt lives in the DOM (VillageCanvas)
   *  via the scene's onGiftOffer callback. */
  onGiftOffered(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!offerId) return;
    const item = payload.item || {};
    const offer = {
      offerId,
      fromSocketId: String(payload.fromSocketId || ''),
      fromName: typeof payload.fromName === 'string' && payload.fromName.trim()
        ? payload.fromName.trim()
        : 'Someone',
      item: {
        type: typeof item.type === 'string' ? item.type : '',
        label: typeof item.label === 'string' && item.label ? item.label : 'a gift',
        emoji: typeof item.emoji === 'string' && item.emoji ? item.emoji : '🎁',
      },
    };
    if (this._incoming) {
      if (!this._incomingQueue.some((o) => o.offerId === offerId)) this._incomingQueue.push(offer);
      return;
    }
    this._incoming = offer;
    try { this.scene?.onGiftOffer?.({ ...offer, item: { ...offer.item } }); } catch {}
  }

  /** Accept the showing offer: pocket room is checked FIRST — a
   *  full pocket auto-declines instead of eating the gift. */
  acceptOffer() {
    if (!this._incoming) return { ok: false, reason: 'not-found' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const offer = this._incoming;
    // The offered item arrives as a plain stored item — canAddItem
    // takes the same shape the inventory keeps.
    if (!canAddItem({ type: offer.item.type })) {
      this.declineOffer();
      try { this.scene?.onSystemNotice?.('🎒 Your pocket is full — make room first.'); } catch {}
      return { ok: false, reason: 'inventory-full' };
    }
    try {
      this.scene.socket.emit('gift_accept', { roomId: this.scene.roomId, offerId: offer.offerId });
    } catch {
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** Decline the showing offer: nothing moves, nothing is spent. */
  declineOffer() {
    if (!this._incoming) return { ok: false, reason: 'not-found' };
    const offer = this._incoming;
    try {
      this.scene.socket.emit('gift_decline', { roomId: this.scene.roomId, offerId: offer.offerId });
    } catch {}
    this._clearIncoming();
    return { ok: true };
  }

  /** The server handed me the gift (I accepted): get it into the
   *  pocket, then confirm — only the confirm tells the giver to
   *  remove it, spend the sheet, and count it. A full pocket
   *  after all (another tab filled it) fails the receive and the
   *  giver keeps everything. */
  onGiftReceived(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!this._incoming || this._incoming.offerId !== offerId) return;
    const item = payload.item || null;
    if (!item || typeof item.type !== 'string') {
      this._sendReceiveFailed(offerId);
      this._clearIncoming();
      return;
    }
    const res = addItem(item);
    if (!res.ok) {
      this._sendReceiveFailed(offerId);
      try { this.scene?.onSystemNotice?.('🎒 Your pocket is full — make room first.'); } catch {}
      this._clearIncoming();
      return;
    }
    try {
      this.scene.socket.emit('gift_received_confirm', { roomId: this.scene.roomId, offerId });
    } catch {}
    const gotText = `📬 You got a wrapped gift: ${res.item.label || 'a gift'}!`;
    try { this.scene?.onSystemNotice?.(gotText); } catch {}
    this._clearIncoming();
  }

  _sendReceiveFailed(offerId) {
    try {
      this.scene.socket.emit('gift_receive_failed', { roomId: this.scene.roomId, offerId });
    } catch {}
  }

  // ---- giver outcomes ----------------------------------------------------

  /** The recipient accepted: the gift is on its way to their
   *  pocket — the item + sheet move only on their confirm
   *  (onGiftConfirmed), never here. */
  onGiftOfferAccepted(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!this._pendingOutgoing || this._pendingOutgoing.offerId !== offerId) return;
    // Nothing to do yet — the confirm below does the moving.
  }

  /** The recipient confirmed receipt: the gift is theirs now.
   *  Remove the item, spend the sheet, count the gift toward
   *  Gift Giver. Exactly once per offer — the pending entry is
   *  cleared first, so a duplicate confirm can never double-spend. */
  onGiftConfirmed(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!this._pendingOutgoing || this._pendingOutgoing.offerId !== offerId) return;
    const pending = this._pendingOutgoing;
    this._clearOutgoing();
    try { spendWrappingSheet(); } catch {}
    try { removeItem(pending.itemId); } catch {}
    try { this.scene?.questManager?.recordGlobalEvent(GIFT_GIVEN_EVENT); } catch {}
    try { this.scene?.onSystemNotice?.('🎁 They accepted your gift!'); } catch {}
  }

  /** The recipient declined: nothing moves, nothing is spent. */
  onGiftDeclined(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!this._pendingOutgoing || this._pendingOutgoing.offerId !== offerId) return;
    this._clearOutgoing();
    try { this.scene?.onSystemNotice?.('They declined your gift — nothing was sent.'); } catch {}
  }

  /** The recipient's pocket was full after all: the gift stays
   *  with you — nothing spent, nothing counted. */
  onGiftFailed(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (!this._pendingOutgoing || this._pendingOutgoing.offerId !== offerId) return;
    this._clearOutgoing();
    try { this.scene?.onSystemNotice?.('Their pocket was full — the gift stayed with you.'); } catch {}
  }

  /** The offer expired (they left, it timed out, the server
   *  swept it): clear the pending state / prompt, silently — no
   *  toast, no blame. */
  onGiftOfferGone(payload = {}) {
    const offerId = String(payload.offerId || '');
    if (this._pendingOutgoing && this._pendingOutgoing.offerId === offerId) {
      this._clearOutgoing();
    }
    if (this._incoming && this._incoming.offerId === offerId) {
      this._clearIncoming();
    }
  }

  // ---- helpers -----------------------------------------------------------

  _displayName() {
    try {
      const p = this.scene?.profile?.profile || {};
      return p.characterName || p.firstName || this.scene?.userId || 'Someone';
    } catch {
      return 'Someone';
    }
  }

  _clearOutgoing() {
    if (this._pendingOutgoing?.timer) {
      try { clearTimeout(this._pendingOutgoing.timer); } catch {}
    }
    this._pendingOutgoing = null;
  }

  _clearIncoming() {
    this._incoming = null;
    try { this.scene?.onGiftOfferGone?.(); } catch {}
    const next = this._incomingQueue.shift();
    if (next) {
      this._incoming = next;
      try { this.scene?.onGiftOffer?.({ ...next, item: { ...next.item } }); } catch {}
    }
  }

  update() {
    // Nothing per-frame: offers arrive over the socket, the prompt
    // is DOM, and the 60s expiry is a timer.
  }

  destroy() {
    this._clearOutgoing();
    this._incoming = null;
    this._incomingQueue = [];
    this.scene = null;
  }
}
