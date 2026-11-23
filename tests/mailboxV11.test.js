// mailboxV11.test.js — Mailbox v1.1 (`sq-mailbox-v1.1`).
//
// Change 1: the "You've got mail!" toast names the mailbox room.
// Change 2: a "Go to my mailbox" button in the pocket panel.
//
// The panel click is tested two ways: the button renders exactly
// when the mailbox room is resolved and you are not already in it
// (react-dom/server), and the click itself is driven through the
// component with a minimal React hooks dispatcher (no DOM in this
// repo — no jsdom/happy-dom installed — so the component is called
// directly with stubbed useState/useEffect/useRef and the returned
// element tree is walked to the button's onClick).

import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  mailToastText,
  goToMailboxRoom,
} from '../src/village/mailState.js';
import { MailSystem } from '../src/village/MailSystem.js';
import { isOpenAccessRoom, requiresGpsProximity } from '../src/accessPolicy.js';
import InventoryPanel from '../src/village/InventoryPanel.jsx';

const SHEPHERD = { id: 'shepherd-park', name: 'Shepherd Park', lat: 29.8341952, lng: -95.4174423, amenity: 'park' };
const AGORA = { id: 'agora-houston', name: 'Agora', lat: 29.76, lng: -95.36 };
const LIBRARY = { id: 'md-anderson-library', name: 'MD Anderson Library', lat: 29.72, lng: -95.34 };
const ALL_ROOMS = [SHEPHERD, AGORA, LIBRARY];
const NEAR_SHEPHERD = { latitude: 29.834, longitude: -95.417 };
const DALLAS = { latitude: 32.78, longitude: -96.8 };

const ONE_PACKAGE = {
  packages: [{
    id: 'p1', fromUserId: 'bob@example.com', fromName: 'Bob',
    item: { id: 'i1', type: 'note', label: 'A note' }, sentAt: 1,
  }],
};

function makeScene({ roomId = 'agora-houston', allRooms = ALL_ROOMS, userLocation = NEAR_SHEPHERD, notices = [] } = {}) {
  return {
    roomId,
    userId: 'alice@example.com',
    userLocation,
    allRooms,
    socket: { connected: true, emit: () => {} },
    profile: { profile: { email: 'alice@example.com', characterName: 'Alice' } },
    onSystemNotice: (msg) => notices.push(msg),
  };
}

// --- Change 1: toast text (pure) -------------------------------------------

describe('mailToastText', () => {
  it('login toast names the room', () => {
    expect(mailToastText({ roomName: 'Shepherd Park' })).toBe('📬 You’ve got mail at Shepherd Park!');
  });
  it('live toast names the room and the sender', () => {
    expect(mailToastText({ roomName: 'Shepherd Park', fromName: 'Alice' }))
      .toBe('📬 You’ve got mail from Alice at Shepherd Park!');
  });
  it('login toast falls back to the plain text without a room', () => {
    expect(mailToastText({})).toBe('📬 You’ve got mail!');
    expect(mailToastText({ roomName: '' })).toBe('📬 You’ve got mail!');
    expect(mailToastText({ roomName: '   ' })).toBe('📬 You’ve got mail!');
  });
  it('live toast falls back to the plain from-text without a room', () => {
    expect(mailToastText({ fromName: 'Alice' })).toBe('📬 You’ve got mail from Alice!');
  });
  it('never shows a blank place', () => {
    expect(mailToastText({ roomName: null, fromName: null })).toBe('📬 You’ve got mail!');
  });
});

// --- Change 1: toasts through MailSystem (mock scene) ----------------------

describe('MailSystem toasts', () => {
  it('login toast names the mailbox room from a different room', () => {
    const notices = [];
    const scene = makeScene({ notices });
    const mail = new MailSystem(scene);
    mail.applyState(ONE_PACKAGE);
    expect(notices).toEqual(['📬 You’ve got mail at Shepherd Park!']);
  });
  it('login toast falls back to plain text when no room resolves', () => {
    const notices = [];
    const scene = makeScene({ allRooms: [], notices });
    const mail = new MailSystem(scene);
    mail.applyState(ONE_PACKAGE);
    expect(notices).toEqual(['📬 You’ve got mail!']);
  });
  it('no login toast when there is no unread mail', () => {
    const notices = [];
    const scene = makeScene({ notices });
    const mail = new MailSystem(scene);
    mail.applyState({ packages: [] });
    expect(notices).toEqual([]);
  });
  it('live toast names the room and the sender', () => {
    const notices = [];
    const scene = makeScene({ notices });
    const mail = new MailSystem(scene);
    mail.onMailArrived({ fromName: 'Bob' });
    expect(notices).toEqual(['📬 You’ve got mail from Bob at Shepherd Park!']);
  });
  it('live toast falls back to the plain from-text when no room resolves', () => {
    const notices = [];
    const scene = makeScene({ allRooms: [], notices });
    const mail = new MailSystem(scene);
    mail.onMailArrived({ fromName: 'Bob' });
    expect(notices).toEqual(['📬 You’ve got mail from Bob!']);
  });
});

// --- Change 2 (v1 gap fix): the mailbox room resolves anywhere ------------

describe('MailSystem.getState mailbox room', () => {
  it('names the mailbox room from a different room', () => {
    const mail = new MailSystem(makeScene({ roomId: 'agora-houston' }));
    const st = mail.getState();
    expect(st.mailboxRoomId).toBe('shepherd-park');
    expect(st.mailboxRoomName).toBe('Shepherd Park');
    expect(st.isMailboxRoom).toBe(false);
  });
  it('falls back to an open-access room with no park close', () => {
    const mail = new MailSystem(makeScene({ roomId: 'agora-houston', userLocation: DALLAS }));
    const st = mail.getState();
    expect(st.mailboxRoomId).toBeTruthy();
    expect(st.mailboxRoomName).toBeTruthy();
    expect(isOpenAccessRoom(st.mailboxRoomId)).toBe(true);
  });
  it('is empty when no room resolves at all', () => {
    const mail = new MailSystem(makeScene({ allRooms: [] }));
    const st = mail.getState();
    expect(st.mailboxRoomId).toBe('');
    expect(st.mailboxRoomName).toBe('');
  });
});

// --- Change 2: the go-to-mailbox seam --------------------------------------

describe('goToMailboxRoom', () => {
  it('closes the pocket panel, then enters the room with id + name', () => {
    const calls = [];
    goToMailboxRoom({
      closePanel: () => calls.push('close'),
      onEnterRoom: (id, name) => calls.push(['enter', id, name]),
      roomId: 'shepherd-park',
      roomName: 'Shepherd Park',
    });
    expect(calls).toEqual(['close', ['enter', 'shepherd-park', 'Shepherd Park']]);
  });
  it('tolerates missing callbacks', () => {
    expect(() => goToMailboxRoom({ roomId: 'x', roomName: 'y' })).not.toThrow();
    expect(() => goToMailboxRoom()).not.toThrow();
  });
});

// --- Change 2: GPS gate inputs (the entry path is handleEnterRoom) --------

describe('mailbox room entry gates', () => {
  it('a fallback open-access room is never GPS-gated', () => {
    for (const id of ['md-anderson-library', 'shepherd-park', 'asgard-games', 'lolas-depot', 'agora-houston']) {
      expect(isOpenAccessRoom(id)).toBe(true);
      expect(requiresGpsProximity({ id, radiusMeters: 60 })).toBe(false);
    }
  });
  it('a GPS-gated park room IS gated, like its map pin', () => {
    expect(requiresGpsProximity({ id: 'some-park', radiusMeters: 60 })).toBe(true);
  });
  it('a park room with no radius has no client-side gate (server backstop)', () => {
    expect(requiresGpsProximity({ id: 'some-park' })).toBe(false);
  });
});

// --- Change 2: the button in the pocket panel ------------------------------

function panelState(overrides = {}) {
  return {
    items: [], count: 0, capacity: 3, hasBag: false, coins: 0, full: false,
    mailboxCode: 'ABCDE', mailboxRoomId: 'shepherd-park', mailboxRoomName: 'Shepherd Park',
    mailUnread: 1, isMailboxRoom: false, hasMailboxKey: true,
    decorNotice: '', decorNoticeSeq: 0, hatNotice: '', hatNoticeSeq: 0,
    mailNotice: '', mailNoticeSeq: 0,
    roomId: 'agora-houston', atHome: false, canDispose: false,
    canHatCat: false, canFeedDucks: false, canFeedCat: false,
    ...overrides,
  };
}

function renderPanel(state, props = {}) {
  return renderToStaticMarkup(
    React.createElement(InventoryPanel, {
      getState: () => state,
      getBadges: () => [],
      onClose: () => {},
      ...props,
    }),
  );
}

describe('InventoryPanel "Go to my mailbox" button', () => {
  it('shows when the mailbox room is resolved and you are elsewhere', () => {
    const html = renderPanel(panelState());
    expect(html).toContain('Go to my mailbox');
    expect(html).toContain('Your mailbox is at Shepherd Park');
  });
  it('hides when the mailbox room is unresolved', () => {
    const html = renderPanel(panelState({ mailboxRoomId: '', mailboxRoomName: '' }));
    expect(html).not.toContain('Go to my mailbox');
  });
  it('hides when you are already in your mailbox room', () => {
    const html = renderPanel(panelState({ isMailboxRoom: true, roomId: 'shepherd-park' }));
    expect(html).not.toContain('Go to my mailbox');
  });
  it('click calls onGoToMailboxRoom with the resolved room id + name', () => {
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const dispatcher = internals.ReactCurrentDispatcher;
    const prev = dispatcher.current;
    const calls = [];
    dispatcher.current = {
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useRef: (v) => ({ current: v }),
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useContext: () => null,
      useReducer: (reducer, init) => [init, () => {}],
      useDeferredValue: (v) => v,
      useTransition: () => [false, (fn) => fn()],
      useId: () => 'test-id',
      useSyncExternalStore: (sub, get) => get(),
    };
    try {
      const tree = InventoryPanel({
        getState: () => panelState(),
        getBadges: () => [],
        onClose: () => {},
        onGoToMailboxRoom: (id, name) => calls.push([id, name]),
      });
      const button = findButton(tree, 'Go to my mailbox');
      expect(button).not.toBeNull();
      button.props.onClick();
    } finally {
      dispatcher.current = prev;
    }
    expect(calls).toEqual([['shepherd-park', 'Shepherd Park']]);
  });
});

/** Walk a React element tree for a host <button> whose text contains
 *  `label`. Returns the element or null. */
function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  const children = node.props?.children;
  const text = typeof children === 'string'
    ? children
    : Array.isArray(children)
      ? children.filter((c) => typeof c === 'string').join('')
      : '';
  if (node.type === 'button' && text.includes(label)) return node;
  return findButton(children, label);
}
