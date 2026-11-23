// mailboxV12.test.js — Mailbox v1.2 (`sq-mailbox-v1.2`).
//
// Per-place mailboxes (user-decided 2026-11-23, option 2): each of
// the player's places gets its OWN mailbox — nearest park room
// within 5 km of THAT PLACE (not the player's current location);
// when no park is close, that place's mailbox sits AT THE PLACE
// ITSELF (the Galveston case). Players with no places keep the v1
// rule (nearest park to current location, fallback nearest
// open-access room). One shared inbox, one key, flag on every
// mailbox. The pocket-button tooltip names the real room now —
// never the generic "at the park".
//
// The panel click is driven the same way as in mailboxV11.test.js
// (a minimal React hooks dispatcher — no DOM in this repo).

import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveMailboxRoomForPlace,
  resolveMailboxRooms,
  nearestMailboxRoom,
  mailboxRoomsLine,
} from '../src/village/mailState.js';
import { MailSystem } from '../src/village/MailSystem.js';
import { isOpenAccessRoom } from '../src/accessPolicy.js';
import InventoryPanel from '../src/village/InventoryPanel.jsx';

const SHEPHERD = { id: 'shepherd-park', name: 'Shepherd Park', lat: 29.8341952, lng: -95.4174423, amenity: 'park' };
const HERMANN = { id: 'hermann-park', name: 'Hermann Park', lat: 29.7213, lng: -95.3903, amenity: 'park' };
const FOREST = { id: 'forest-gate', name: 'Forest Gate', lat: 29.7630, lng: -95.3720, amenity: 'park' };
const AGORA = { id: 'agora-houston', name: 'Agora', lat: 29.76, lng: -95.36 };
const LIBRARY = { id: 'md-anderson-library', name: 'MD Anderson Library', lat: 29.72, lng: -95.34 };
// The user's places: Houston (Garden Oaks, ~3.7 km from Shepherd
// Park) and Galveston (18715 Warrior Drive, ~29.55, -94.98 — no
// park room within 5 km of it at all).
const HOME_HOUSTON = { id: 'home-alice-example-com', name: 'Your Place', lat: 29.815, lng: -95.4497, kind: 'home' };
const HOME_GALVESTON = { id: 'home-alice-example-com_2', name: 'Your Place 2', lat: 29.55, lng: -94.98, kind: 'home' };
const HOME_HOUSTON_2 = { id: 'home-alice-example-com_2', name: 'Your Place 2', lat: 29.82, lng: -95.44, kind: 'home' };
const ALL_ROOMS = [SHEPHERD, HERMANN, FOREST, AGORA, LIBRARY, HOME_HOUSTON, HOME_GALVESTON];
const NEAR_HOUSTON = { latitude: 29.815, longitude: -95.4497 };
const IN_GALVESTON = { latitude: 29.55, longitude: -94.98 };
const DALLAS = { latitude: 32.78, longitude: -96.8 };

const ONE_PACKAGE = {
  packages: [{
    id: 'p1', fromUserId: 'bob@example.com', fromName: 'Bob',
    item: { id: 'i1', type: 'note', label: 'A note' }, sentAt: 1,
  }],
};

function makeScene({
  roomId = 'agora-houston',
  allRooms = ALL_ROOMS,
  userLocation = NEAR_HOUSTON,
  notices = [],
  withAdd = false,
} = {}) {
  const scene = {
    roomId,
    userId: 'alice@example.com',
    userLocation,
    allRooms,
    socket: { connected: true, emit: () => {} },
    profile: { profile: { email: 'alice@example.com', characterName: 'Alice' } },
    onSystemNotice: (msg) => notices.push(msg),
  };
  if (withAdd) {
    const mkGfx = () => {
      const g = {
        fillStyle: () => g, fillRect: () => g, fillTriangle: () => g,
        setDepth: () => g, destroy: () => {},
      };
      return g;
    };
    scene.add = {
      graphics: () => mkGfx(),
      text: () => ({ setOrigin: () => {}, setDepth: () => {}, destroy: () => {} }),
    };
    // Home-room layout (layouts/home.js): entry bottom centre,
    // spawn just inside it, chest on the north wall.
    scene.roomLayout = {
      layout: {
        floors: [{ zones: [{ type: 'entry', x: 700, y: 780, w: 200, h: 40 }] }],
        spawnF1: { x: 800, y: 720 },
      },
      currentFloor: 0,
      getBoundaryBounds: () => ({ x: 80, y: 80, w: 1440, h: 740 }),
      isPointInsideRoom: (x, y) => x >= 80 && x <= 1520 && y >= 80 && y <= 820,
    };
  }
  return scene;
}

// --- one place's mailbox ---------------------------------------------------

describe('resolveMailboxRoomForPlace', () => {
  it('Houston place → Shepherd Park (nearest park within 5 km)', () => {
    const r = resolveMailboxRoomForPlace(HOME_HOUSTON, ALL_ROOMS, 1);
    expect(r.roomId).toBe('shepherd-park');
    expect(r.roomName).toBe('Shepherd Park');
    expect(r.isPark).toBe(true);
    expect(r.isHome).toBe(false);
    expect(r.placeIndex).toBe(1);
    expect(r.placeId).toBe(HOME_HOUSTON.id);
    expect(r.distanceM).toBeLessThanOrEqual(5000);
    expect(r.distanceM).toBeGreaterThan(0);
  });
  it('Galveston place → the mailbox sits AT the place itself', () => {
    const r = resolveMailboxRoomForPlace(HOME_GALVESTON, ALL_ROOMS, 2);
    expect(r.roomId).toBe(HOME_GALVESTON.id);
    expect(r.roomName).toBe('Your Place 2');
    expect(r.isPark).toBe(false);
    expect(r.isHome).toBe(true);
    expect(r.placeIndex).toBe(2);
    expect(r.distanceM).toBe(0);
  });
  it('a place with no coordinates → at the place itself (always reachable)', () => {
    const r = resolveMailboxRoomForPlace(
      { id: 'home-alice-example-com', name: 'Your Place' }, ALL_ROOMS, 1,
    );
    expect(r.roomId).toBe('home-alice-example-com');
    expect(r.isHome).toBe(true);
  });
  it('a custom place name is kept', () => {
    const r = resolveMailboxRoomForPlace(
      { ...HOME_GALVESTON, name: 'Galveston' }, ALL_ROOMS, 2,
    );
    expect(r.roomName).toBe('Galveston');
  });
  it('returns null for an unusable place', () => {
    expect(resolveMailboxRoomForPlace(null, ALL_ROOMS, 1)).toBeNull();
    expect(resolveMailboxRoomForPlace({}, ALL_ROOMS, 1)).toBeNull();
  });
});

// --- all of the player's mailbox rooms ------------------------------------

describe('resolveMailboxRooms', () => {
  it('two places → two mailboxes: Shepherd Park + the Galveston place', () => {
    const rooms = resolveMailboxRooms(ALL_ROOMS, IN_GALVESTON, [HOME_HOUSTON, HOME_GALVESTON]);
    expect(rooms.map((r) => r.roomId)).toEqual(['shepherd-park', 'home-alice-example-com_2']);
    expect(rooms[0].isPark).toBe(true);
    expect(rooms[1].isHome).toBe(true);
  });
  it('the result does not depend on where the player is standing', () => {
    // Same places, different current location — same mailbox rooms.
    const inHouston = resolveMailboxRooms(ALL_ROOMS, NEAR_HOUSTON, [HOME_HOUSTON, HOME_GALVESTON]);
    const inGalveston = resolveMailboxRooms(ALL_ROOMS, IN_GALVESTON, [HOME_HOUSTON, HOME_GALVESTON]);
    expect(inHouston.map((r) => r.roomId)).toEqual(inGalveston.map((r) => r.roomId));
  });
  it('two places near the same park share one mailbox room', () => {
    const rooms = resolveMailboxRooms(ALL_ROOMS, NEAR_HOUSTON, [HOME_HOUSTON, HOME_HOUSTON_2]);
    expect(rooms.map((r) => r.roomId)).toEqual(['shepherd-park']);
    expect(rooms[0].placeIndex).toBe(1);
  });
  it('no places → the v1 rule, unchanged (nearest park to current location)', () => {
    const rooms = resolveMailboxRooms(ALL_ROOMS, NEAR_HOUSTON, []);
    expect(rooms.map((r) => r.roomId)).toEqual(['shepherd-park']);
    expect(rooms[0].placeIndex).toBe(0);
  });
  it('no places and no park close → the v1 open-access fallback', () => {
    const rooms = resolveMailboxRooms(ALL_ROOMS, DALLAS, []);
    expect(rooms).toHaveLength(1);
    expect(isOpenAccessRoom(rooms[0].roomId)).toBe(true);
  });
  it('empty room list → no mailbox rooms', () => {
    expect(resolveMailboxRooms([], NEAR_HOUSTON, [HOME_HOUSTON])).toEqual([]);
    expect(resolveMailboxRooms([], NEAR_HOUSTON, [])).toEqual([]);
  });
});

// --- nearest mailbox room ----------------------------------------------------

describe('nearestMailboxRoom', () => {
  const two = resolveMailboxRooms(ALL_ROOMS, NEAR_HOUSTON, [HOME_HOUSTON, HOME_GALVESTON]);
  it('from Galveston → the Galveston place', () => {
    expect(nearestMailboxRoom(two, ALL_ROOMS, IN_GALVESTON).roomId).toBe('home-alice-example-com_2');
  });
  it('from Houston → Shepherd Park', () => {
    expect(nearestMailboxRoom(two, ALL_ROOMS, NEAR_HOUSTON).roomId).toBe('shepherd-park');
  });
  it('no location → the first entry (place #1)', () => {
    expect(nearestMailboxRoom(two, ALL_ROOMS, null).roomId).toBe('shepherd-park');
  });
  it('one room → it, whatever the location', () => {
    expect(nearestMailboxRoom([two[0]], ALL_ROOMS, IN_GALVESTON).roomId).toBe('shepherd-park');
  });
  it('empty → null', () => {
    expect(nearestMailboxRoom([], ALL_ROOMS, NEAR_HOUSTON)).toBeNull();
  });
});

// --- the pocket line ---------------------------------------------------------

describe('mailboxRoomsLine', () => {
  it('one room → singular, naming the real room', () => {
    expect(mailboxRoomsLine([{ roomName: 'Shepherd Park' }]))
      .toBe('Your mailbox is at Shepherd Park');
  });
  it('two rooms → plural, naming both real rooms', () => {
    expect(mailboxRoomsLine([{ roomName: 'Shepherd Park' }, { roomName: 'Your Place 2' }]))
      .toBe('Your mailboxes are at Shepherd Park and Your Place 2');
  });
  it('empty list falls back to the single nearest name', () => {
    expect(mailboxRoomsLine([], 'Shepherd Park')).toBe('Your mailbox is at Shepherd Park');
  });
  it('empty list and no fallback → blank, never a generic "at the park"', () => {
    expect(mailboxRoomsLine([])).toBe('');
    expect(mailboxRoomsLine([], '')).toBe('');
    expect(mailboxRoomsLine([{ roomName: '' }])).toBe('');
  });
});

// --- MailSystem: per-place state, toast, flag, home-room spot --------------

describe('MailSystem.getState per-place mailboxes', () => {
  it('two places → two mailbox rooms in getState', () => {
    const mail = new MailSystem(makeScene({ userLocation: IN_GALVESTON }));
    const st = mail.getState();
    expect(st.mailboxRooms.map((r) => r.roomId))
      .toEqual(['shepherd-park', 'home-alice-example-com_2']);
  });
  it('nearest is the Galveston place when standing in Galveston', () => {
    const mail = new MailSystem(makeScene({ userLocation: IN_GALVESTON }));
    const st = mail.getState();
    expect(st.mailboxRoomId).toBe('home-alice-example-com_2');
    expect(st.mailboxRoomName).toBe('Your Place 2');
    expect(st.isMailboxRoom).toBe(false);
  });
  it('nearest is Shepherd Park when standing in Houston', () => {
    const mail = new MailSystem(makeScene({ userLocation: NEAR_HOUSTON }));
    const st = mail.getState();
    expect(st.mailboxRoomId).toBe('shepherd-park');
    expect(st.mailboxRoomName).toBe('Shepherd Park');
  });
  it('no places → the v1 single room (nearest park to current location)', () => {
    const scene = makeScene({ userLocation: NEAR_HOUSTON });
    scene.profile = { profile: { email: '', characterName: 'Guest' } };
    const mail = new MailSystem(scene);
    const st = mail.getState();
    expect(st.mailboxRooms.map((r) => r.roomId)).toEqual(['shepherd-park']);
  });
  it('login toast names the NEAREST mailbox room (Galveston, from Galveston)', () => {
    const notices = [];
    const mail = new MailSystem(makeScene({ userLocation: IN_GALVESTON, notices }));
    mail.applyState(ONE_PACKAGE);
    expect(notices).toEqual(['📬 You’ve got mail at Your Place 2!']);
  });
  it('login toast names Shepherd Park from Houston', () => {
    const notices = [];
    const mail = new MailSystem(makeScene({ userLocation: NEAR_HOUSTON, notices }));
    mail.applyState(ONE_PACKAGE);
    expect(notices).toEqual(['📬 You’ve got mail at Shepherd Park!']);
  });
});

describe('MailSystem mailbox object in a home room', () => {
  it('draws in the Galveston home room, east of the entry, clear of the chest', () => {
    const scene = makeScene({
      roomId: 'home-alice-example-com_2',
      userLocation: IN_GALVESTON,
      withAdd: true,
    });
    const mail = new MailSystem(scene);
    mail.refresh();
    expect(mail.isMailboxRoom).toBe(true);
    const b = mail._mailbox;
    expect(b).not.toBeNull();
    expect(b.roomId).toBe('home-alice-example-com_2');
    expect(b.isHome).toBe(true);
    // East of the entry (entry x 700–900): the box starts at 940.
    expect(b.x).toBe(940);
    // Inside the home bounds (80–1520, 80–820)…
    expect(b.x).toBeGreaterThanOrEqual(80);
    expect(b.y).toBeGreaterThanOrEqual(80);
    expect(b.x + b.w).toBeLessThanOrEqual(1520);
    expect(b.y + b.h).toBeLessThanOrEqual(820);
    // …and clear of the storage chest on the north wall (740,150,120x80).
    const overlapsChest = b.x < 740 + 120 && b.x + b.w > 740 && b.y < 150 + 80 && b.y + b.h > 150;
    expect(overlapsChest).toBe(false);
  });
  it('draws the red flag in the Galveston home room while mail waits', () => {
    const scene = makeScene({
      roomId: 'home-alice-example-com_2',
      userLocation: IN_GALVESTON,
      withAdd: true,
    });
    const mail = new MailSystem(scene);
    mail.refresh();
    mail.applyState(ONE_PACKAGE);
    expect(mail._flagGfx).not.toBeNull();
  });
  it('draws the red flag in the Shepherd Park room too (flag on every mailbox)', () => {
    const scene = makeScene({
      roomId: 'shepherd-park',
      userLocation: NEAR_HOUSTON,
      withAdd: true,
    });
    const mail = new MailSystem(scene);
    mail.refresh();
    mail.applyState(ONE_PACKAGE);
    expect(mail._flagGfx).not.toBeNull();
  });
  it('draws nothing in a room that is not a mailbox room', () => {
    const scene = makeScene({ roomId: 'agora-houston', userLocation: NEAR_HOUSTON, withAdd: true });
    const mail = new MailSystem(scene);
    mail.refresh();
    expect(mail.isMailboxRoom).toBe(false);
    expect(mail._mailbox).toBeNull();
  });
  it('the key opens the mailbox in the Galveston home room', () => {
    let opened = 0;
    const scene = makeScene({
      roomId: 'home-alice-example-com_2',
      userLocation: IN_GALVESTON,
      withAdd: true,
    });
    scene.onOpenMailbox = () => { opened += 1; };
    const mail = new MailSystem(scene);
    mail.refresh();
    expect(mail.getState().hasKey).toBe(true);
    mail.openMailbox();
    expect(opened).toBe(1);
  });
  it('the same key opens the mailbox in the Shepherd Park room', () => {
    let opened = 0;
    const scene = makeScene({
      roomId: 'shepherd-park',
      userLocation: NEAR_HOUSTON,
      withAdd: true,
    });
    scene.onOpenMailbox = () => { opened += 1; };
    const mail = new MailSystem(scene);
    mail.refresh();
    expect(mail.getState().hasKey).toBe(true);
    mail.openMailbox();
    expect(opened).toBe(1);
  });
});

// --- pocket panel: line + Go button ------------------------------------------

function panelState(overrides = {}) {
  return {
    items: [], count: 0, capacity: 3, hasBag: false, coins: 0, full: false,
    mailboxCode: 'ABCDE',
    mailboxRooms: [
      { roomId: 'shepherd-park', roomName: 'Shepherd Park', isPark: true, isHome: false, placeIndex: 1 },
      { roomId: 'home-alice-example-com_2', roomName: 'Your Place 2', isPark: false, isHome: true, placeIndex: 2 },
    ],
    mailboxRoomId: 'home-alice-example-com_2', mailboxRoomName: 'Your Place 2',
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

describe('InventoryPanel pocket line (two mailboxes)', () => {
  it('names BOTH mailbox rooms', () => {
    const html = renderPanel(panelState());
    expect(html).toContain('Your mailboxes are at Shepherd Park and Your Place 2');
  });
  it('one room → the singular line', () => {
    const html = renderPanel(panelState({
      mailboxRooms: [{ roomId: 'shepherd-park', roomName: 'Shepherd Park', isPark: true }],
      mailboxRoomId: 'shepherd-park',
      mailboxRoomName: 'Shepherd Park',
    }));
    expect(html).toContain('Your mailbox is at Shepherd Park');
    expect(html).not.toContain('Your mailboxes are');
  });
  it('never says the generic "at the park"', () => {
    const html = renderPanel(panelState());
    expect(html).not.toContain('at the park');
  });
  it('Go button goes to the NEAREST mailbox room', () => {
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
    expect(calls).toEqual([['home-alice-example-com_2', 'Your Place 2']]);
  });
  it('Go button hides in ANY mailbox room', () => {
    const html = renderPanel(panelState({ isMailboxRoom: true, roomId: 'home-alice-example-com_2' }));
    expect(html).not.toContain('Go to my mailbox');
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
