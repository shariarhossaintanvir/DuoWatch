import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../src/lib/roomService';

describe('Host Invitation Flow & Passcode Verification', () => {
  beforeEach(() => {
    const storageMock = () => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value.toString(); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
      };
    };

    if (typeof window === 'undefined' || !window.localStorage) {
      (globalThis as any).localStorage = storageMock();
      (globalThis as any).sessionStorage = storageMock();
    } else {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

  it('complete host-to-guest invitation flow with secure passcode display and join validation', async () => {
    // 1. Host creates room
    const createRes = await RoomService.createRoom('Midnight Movie', 'Alice', 'youtube');
    expect(createRes.success).toBe(true);
    expect(createRes.room).toBeDefined();

    const createdRoom = createRes.room!;
    expect(createdRoom.roomCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(createdRoom.ownerToken).toBeDefined();
    expect(createdRoom.guestPasscode).toBeDefined();
    expect(createdRoom.guestPasscode?.length).toBe(32);

    const generatedPasscode = createdRoom.guestPasscode!;
    const generatedOwnerToken = createdRoom.ownerToken!;

    // 2. Host joins as Owner (mimicking CreateRoomPage flow)
    const hostJoin = await RoomService.joinRoom(
      createdRoom.roomCode,
      'host-alice-123',
      'Alice',
      generatedOwnerToken,
      'owner'
    );
    expect(hostJoin.success).toBe(true);
    expect(hostJoin.room).toBeDefined();

    const hostSession = hostJoin.room!;
    // Verify guestPasscode is preserved in host session for the invitation modal
    expect(hostSession.guestPasscode).toBe(generatedPasscode);
    expect(hostSession.role).toBe('owner');
    expect(hostSession.ownerToken).toBe(generatedOwnerToken);

    // Verify sessionStorage retains the guestPasscode for browser refresh recovery
    const saved = RoomService.getSavedSession(createdRoom.roomCode);
    expect(saved).not.toBeNull();
    expect(saved?.guestPasscode).toBe(generatedPasscode);

    // 3. Construct hardened invitation URL using URL fragment (#passcode=) as done by RoomShareModal
    const origin = 'http://localhost:5173';
    const inviteUrl = `${origin}/join?code=${encodeURIComponent(hostSession.roomCode)}${
      hostSession.guestPasscode ? `#passcode=${encodeURIComponent(hostSession.guestPasscode)}` : ''
    }`;

    // Security Verification: Passcode MUST NOT appear in query parameters (?passcode= or &passcode=)
    expect(inviteUrl).not.toContain('?passcode=');
    expect(inviteUrl).not.toContain('&passcode=');
    expect(inviteUrl).toContain(`code=${hostSession.roomCode}`);
    expect(inviteUrl).toContain(`#passcode=${generatedPasscode}`);

    // Verify invitation URL never exposes ownerToken or sessionToken
    expect(inviteUrl).not.toContain(generatedOwnerToken);
    if (hostSession.sessionToken) {
      expect(inviteUrl).not.toContain(hostSession.sessionToken);
    }

    // 4. Extract credentials as JoinRoomPage does
    const urlObj = new URL(inviteUrl);
    const extractedCode = urlObj.searchParams.get('code')!;
    expect(urlObj.searchParams.get('passcode')).toBeNull(); // Query parameter is clean!

    // Extract from hash fragment
    const hashStr = urlObj.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hashStr);
    const extractedPasscode = hashParams.get('passcode')!;
    expect(extractedCode).toBe(hostSession.roomCode);
    expect(extractedPasscode).toBe(generatedPasscode);

    // Verify backward compatibility with legacy query parameter format
    const legacyUrl = new URL(`${origin}/join?code=${hostSession.roomCode}&passcode=${generatedPasscode}`);
    const legacyPasscode = legacyUrl.searchParams.get('passcode');
    expect(legacyPasscode).toBe(generatedPasscode);

    // 5. Guest Bob joins using extracted credentials
    const guestJoin = await RoomService.joinRoom(
      extractedCode,
      'guest-bob-456',
      'Bob',
      extractedPasscode,
      'partner'
    );
    expect(guestJoin.success).toBe(true);
    expect(guestJoin.room).toBeDefined();

    const guestSession = guestJoin.room!;
    expect(guestSession.role).toBe('partner');
    expect(guestSession.roomCode).toBe(hostSession.roomCode);
    // Guest must NEVER receive host's ownerToken
    expect(guestSession.ownerToken).toBeUndefined();

    // 6. Adversary Charlie attempts to use guest passcode to join as 'owner' -> strictly rejected
    const attackerOwnerAttempt = await RoomService.joinRoom(
      extractedCode,
      'attacker-789',
      'Attacker',
      extractedPasscode,
      'owner'
    );
    expect(attackerOwnerAttempt.success).toBe(false);

    // 7. Third participant attempts to join with valid passcode when room is full -> rejected
    const thirdPartyAttempt = await RoomService.joinRoom(
      extractedCode,
      'charlie-999',
      'Charlie',
      extractedPasscode,
      'partner'
    );
    expect(thirdPartyAttempt.success).toBe(false);
    expect(thirdPartyAttempt.error).toBe('ROOM_FULL');

    // 8. Cleanup
    if (hostSession.sessionToken) {
      await RoomService.leaveRoom(hostSession.roomCode, 'host-alice-123', hostSession.sessionToken);
    }
    if (guestSession.sessionToken) {
      await RoomService.leaveRoom(guestSession.roomCode, 'guest-bob-456', guestSession.sessionToken);
    }
  }, 25000);
});
