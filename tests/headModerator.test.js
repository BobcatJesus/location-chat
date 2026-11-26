import { describe, it, expect } from 'vitest';
import {
  OWNER_MODERATOR_EMAIL,
  normalizeActorId,
  buildModeratorEmails,
  isGlobalModerator,
  getVenuePermissions,
} from '../server/moderators.js';

// Head Moderator v1 (`sq-head-moderator-v1`): the app owner
// (tfkelleher3@gmail.com) is a global moderator in every room, in
// addition to the MODERATOR_EMAILS env var. The pure permission logic
// lives in server/moderators.js because server/socket.js starts
// listening on import and cannot be imported in a test (same
// precedent as the gift-giver kit, which verified its socket.js
// wiring by grep); the socket.js wiring itself is verified by grep at
// kit verification, not here.

const OWNER = 'tfkelleher3@gmail.com';
// The Agora is system-owned: its room definition has no ownerId or
// creator, so getVenueOwnerId returns '' for it and isOwner is false
// for everyone there. Only a global moderator can manage it.
const agoraOwnerId = () => '';

describe('head moderator (sq-head-moderator-v1)', () => {
  describe('buildModeratorEmails', () => {
    it('always includes the owner email, even when the env var is empty', () => {
      for (const env of ['', undefined, null]) {
        const set = buildModeratorEmails(env);
        expect(set.has(OWNER)).toBe(true);
        expect(set.size).toBe(1);
      }
    });

    it('matches the owner email regardless of case', () => {
      const set = buildModeratorEmails('TFKelleher3@Gmail.COM');
      expect(set.has(OWNER)).toBe(true);
      // The differently-cased env entry is the same address, not a second moderator.
      expect(set.size).toBe(1);
    });

    it('trims surrounding whitespace on env entries', () => {
      const set = buildModeratorEmails('  tfkelleher3@gmail.com  ');
      expect(set.has(OWNER)).toBe(true);
      expect(set.size).toBe(1);
    });

    it('keeps env-var emails working alongside the owner', () => {
      const set = buildModeratorEmails('alice@example.com, bob@example.com');
      expect(set.has('alice@example.com')).toBe(true);
      expect(set.has('bob@example.com')).toBe(true);
      expect(set.has(OWNER)).toBe(true);
      expect(set.size).toBe(3);
    });

    it('drops empty env entries', () => {
      const set = buildModeratorEmails('alice@example.com,,, ,bob@example.com,');
      expect(set.has('')).toBe(false);
      expect(set.has('alice@example.com')).toBe(true);
      expect(set.has('bob@example.com')).toBe(true);
    });

    it('never grants moderator to guest on its own', () => {
      const set = buildModeratorEmails('');
      expect(set.has('guest')).toBe(false);
    });
  });

  describe('isGlobalModerator', () => {
    const set = buildModeratorEmails('');

    it('recognizes the owner email exactly', () => {
      expect(isGlobalModerator(OWNER, set)).toBe(true);
    });

    it('recognizes the owner email regardless of case and whitespace', () => {
      expect(isGlobalModerator('TFKELLEHER3@GMAIL.COM', set)).toBe(true);
      expect(isGlobalModerator('  tfkelleher3@gmail.com  ', set)).toBe(true);
    });

    it('rejects a random email, guest, and empty/missing actors', () => {
      expect(isGlobalModerator('random@example.com', set)).toBe(false);
      expect(isGlobalModerator('guest', set)).toBe(false);
      expect(isGlobalModerator('', set)).toBe(false);
      expect(isGlobalModerator(null, set)).toBe(false);
      expect(isGlobalModerator(undefined, set)).toBe(false);
    });
  });

  describe('getVenuePermissions', () => {
    const set = buildModeratorEmails('alice@example.com');

    it('lets the owner manage the Agora (system-owned, no owner)', () => {
      expect(getVenuePermissions('agora-houston', OWNER, set, agoraOwnerId)).toEqual({
        isModerator: true,
        isOwner: false,
        canManage: true,
      });
    });

    it('lets the owner manage any room, not just the Agora', () => {
      expect(getVenuePermissions('some-other-room', OWNER, set, () => '')).toEqual({
        isModerator: true,
        isOwner: false,
        canManage: true,
      });
    });

    it('denies a random email in the Agora', () => {
      expect(getVenuePermissions('agora-houston', 'random@example.com', set, agoraOwnerId)).toEqual({
        isModerator: false,
        isOwner: false,
        canManage: false,
      });
    });

    it('denies guest in the Agora', () => {
      expect(getVenuePermissions('agora-houston', 'guest', set, agoraOwnerId)).toEqual({
        isModerator: false,
        isOwner: false,
        canManage: false,
      });
    });

    it('lets an env-var moderator manage a room', () => {
      expect(getVenuePermissions('agora-houston', 'alice@example.com', set, agoraOwnerId)).toEqual({
        isModerator: true,
        isOwner: false,
        canManage: true,
      });
    });

    it('lets a room owner manage their own room', () => {
      const ownerLookup = () => 'owner@example.com';
      expect(getVenuePermissions('home-xyz', 'owner@example.com', set, ownerLookup)).toEqual({
        isModerator: false,
        isOwner: true,
        canManage: true,
      });
    });

    it('matches a room owner regardless of case', () => {
      const ownerLookup = () => 'owner@example.com';
      const perms = getVenuePermissions('home-xyz', 'Owner@Example.com', set, ownerLookup);
      expect(perms.isOwner).toBe(true);
      expect(perms.canManage).toBe(true);
    });

    it('denies a non-owner, non-moderator in someone else\'s room', () => {
      const ownerLookup = () => 'owner@example.com';
      expect(getVenuePermissions('home-xyz', 'stranger@example.com', set, ownerLookup)).toEqual({
        isModerator: false,
        isOwner: false,
        canManage: false,
      });
    });

    it('handles a missing actor without crashing', () => {
      expect(getVenuePermissions('agora-houston', undefined, set, agoraOwnerId)).toEqual({
        isModerator: false,
        isOwner: false,
        canManage: false,
      });
    });
  });

  describe('normalizeActorId', () => {
    it('trims and lowercases', () => {
      expect(normalizeActorId('  Alice@Example.COM ')).toBe('alice@example.com');
      expect(normalizeActorId('')).toBe('');
      expect(normalizeActorId(null)).toBe('');
    });

    it('exposes the owner constant as the documented address', () => {
      expect(OWNER_MODERATOR_EMAIL).toBe(OWNER);
    });
  });
});
