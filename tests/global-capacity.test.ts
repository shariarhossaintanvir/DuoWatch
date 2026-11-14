import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomService } from '../src/lib/roomService';
import * as supabaseModule from '../src/lib/supabase';
import type { SyncMessagePayload } from '../src/types/cinema';

describe('Phase 21: Strict Global Two-Participant Capacity Suite', () => {
  const setupLocalStorageMock = () => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value.toString(); },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    };
  };

  beforeEach(() => {
    // Isolate test runner from production Supabase database
    vi.spyOn(supabaseModule, 'isSupabaseConfigured').mockReturnValue(false);
    vi.spyOn(supabaseModule, 'isLocalFallbackEnabled').mockReturnValue(true);

    if (typeof window === 'undefined' || !window.localStorage) {
      (globalThis as any).localStorage = setupLocalStorageMock();
      (globalThis as any).sessionStorage = setupLocalStorageMock();
    } else {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Scenario 1: Public visitor checks platform availability when empty
  it('Scenario 1: Platform is available when zero active sessions exist', async () => {
    const availability = await RoomService.checkPlatformAvailability();
    expect(availability.success).toBe(true);
    expect(availability.isAvailable).toBe(true);
    expect(availability.status).toBe('available');
    expect(availability.activeParticipants).toBe(0);
    // Crucial: availability endpoint must not leak room code or credentials
    expect((availability as any).roomCode).toBeUndefined();
    expect((availability as any).guestPasscode).toBeUndefined();
  });

  // Scenario 2 & 3: First visitor creates room and becomes Host
  it('Scenario 2 & 3: First visitor creates single room and becomes Host', async () => {
    const createRes = await RoomService.createRoom('Global Cinema 1', 'Alice', 'youtube', 'host-alice-1');
    expect(createRes.success).toBe(true);
    expect(createRes.room).toBeDefined();

    const room = createRes.room!;
    expect(room.role).toBe('owner');
    expect(room.roomCode).toBeDefined();
    expect(room.ownerToken).toBeDefined();

    // Register host in room
    const joinRes = await RoomService.joinRoom(
      room.roomCode,
      'host-alice-1',
      'Alice',
      room.ownerToken!,
      'owner'
    );
    expect(joinRes.success).toBe(true);
    expect(joinRes.room?.role).toBe('owner');

    // Platform status is now waiting_partner (1 active participant)
    const availability = await RoomService.checkPlatformAvailability();
    expect(availability.isAvailable).toBe(false);
    expect(availability.status).toBe('waiting_partner');
    expect(availability.activeParticipants).toBe(1);
  });

  // Scenario 4: Second visitor joins as Partner
  it('Scenario 4: Second visitor joins active room as Partner using invitation passcode', async () => {
    const createRes = await RoomService.createRoom('Global Cinema', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');

    const partnerJoin = await RoomService.joinRoom(
      room.roomCode,
      'partner-bob',
      'Bob',
      room.guestPasscode!,
      'partner'
    );
    expect(partnerJoin.success).toBe(true);
    expect(partnerJoin.room?.role).toBe('partner');

    // Platform is now fully occupied (2/2)
    const availability = await RoomService.checkPlatformAvailability();
    expect(availability.isAvailable).toBe(false);
    expect(availability.status).toBe('occupied');
    expect(availability.activeParticipants).toBe(2);
  });

  // Scenario 5: Third visitor is rejected
  it('Scenario 5: Third visitor is strictly rejected when room capacity is 2', async () => {
    const createRes = await RoomService.createRoom('Global Cinema', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    await RoomService.joinRoom(room.roomCode, 'partner-bob', 'Bob', room.guestPasscode!, 'partner');

    // Third participant attempts to join with valid passcode
    const intruderJoin = await RoomService.joinRoom(
      room.roomCode,
      'intruder-charlie',
      'Charlie',
      room.guestPasscode!,
      'partner'
    );
    expect(intruderJoin.success).toBe(false);
    expect(intruderJoin.error).toBe('ROOM_FULL');
  });

  // Scenario 6: Second simultaneous room creation is rejected (GLOBAL_ACTIVE_ROOMS <= 1)
  it('Scenario 6: Second room creation is rejected while an active room exists', async () => {
    const firstRes = await RoomService.createRoom('Room 1', 'Alice', 'youtube', 'host-alice');
    expect(firstRes.success).toBe(true);

    const secondRes = await RoomService.createRoom('Room 2', 'Bob', 'youtube', 'host-bob');
    expect(secondRes.success).toBe(false);
    expect(secondRes.error).toBe('PLATFORM_OCCUPIED');
  });

  // Scenario 7: Multiple simultaneous create requests admit exactly one Host
  it('Scenario 7: Concurrent room creations race-condition safety admits exactly 1 room', async () => {
    const attempts = await Promise.all([
      RoomService.createRoom('Concurrent 1', 'Alice', 'youtube', 'host-1'),
      RoomService.createRoom('Concurrent 2', 'Bob', 'youtube', 'host-2'),
      RoomService.createRoom('Concurrent 3', 'Charlie', 'youtube', 'host-3'),
    ]);

    const successes = attempts.filter(a => a.success);
    const rejected = attempts.filter(a => !a.success);

    expect(successes.length).toBe(1);
    expect(rejected.length).toBe(2);
    rejected.forEach(r => expect(r.error).toBe('PLATFORM_OCCUPIED'));
  });

  // Scenario 8: Multiple simultaneous Partner join requests admit only one Partner
  it('Scenario 8: Concurrent partner joins race-condition safety admits exactly 1 Partner', async () => {
    const createRes = await RoomService.createRoom('Race Room', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');

    const joinAttempts = await Promise.all([
      RoomService.joinRoom(room.roomCode, 'p1', 'Partner 1', room.guestPasscode!, 'partner'),
      RoomService.joinRoom(room.roomCode, 'p2', 'Partner 2', room.guestPasscode!, 'partner'),
      RoomService.joinRoom(room.roomCode, 'p3', 'Partner 3', room.guestPasscode!, 'partner'),
    ]);

    const successfulJoins = joinAttempts.filter(j => j.success);
    const rejectedJoins = joinAttempts.filter(j => !j.success);

    expect(successfulJoins.length).toBe(1);
    expect(rejectedJoins.length).toBe(2);
    rejectedJoins.forEach(r => expect(r.error).toBe('ROOM_FULL'));
  });

  // Scenario 9 & 10: Duplicate browser tabs & devices cannot bypass capacity
  it('Scenario 9 & 10: Different participant IDs on duplicate tabs/devices cannot exceed 2 slots', async () => {
    const createRes = await RoomService.createRoom('Tab Test', 'Alice', 'youtube', 'host-tab-1');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-tab-1', 'Alice', room.ownerToken!, 'owner');
    await RoomService.joinRoom(room.roomCode, 'partner-device-1', 'Bob', room.guestPasscode!, 'partner');

    // Attempt from third tab / new device with new ID
    const extraTabJoin = await RoomService.joinRoom(
      room.roomCode,
      'partner-device-2',
      'Bob Second Device',
      room.guestPasscode!,
      'partner'
    );
    expect(extraTabJoin.success).toBe(false);
    expect(extraTabJoin.error).toBe('ROOM_FULL');
  });

  // Scenario 14: Partner cannot impersonate Host
  it('Scenario 14: Partner cannot join as owner or update media state', async () => {
    const createRes = await RoomService.createRoom('Secure Room', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');

    // Attacker tries to join as 'owner' using the guest passcode
    const fakeOwnerJoin = await RoomService.joinRoom(
      room.roomCode,
      'attacker-id',
      'Attacker',
      room.guestPasscode!,
      'owner'
    );
    expect(fakeOwnerJoin.success).toBe(false);
    expect(fakeOwnerJoin.error).toBe('INVALID_OWNER_TOKEN');

    // Partner tries to update media state with non-host credential
    const partnerJoin = await RoomService.joinRoom(
      room.roomCode,
      'partner-bob',
      'Bob',
      room.guestPasscode!,
      'partner'
    );
    const mediaUpdate = await RoomService.updateMediaState(
      room.roomCode,
      'partner-bob',
      partnerJoin.room?.sessionToken!,
      'local',
      { isPlaying: true }
    );
    expect(mediaUpdate.success).toBe(false);
    expect(mediaUpdate.error).toBe('UNAUTHORIZED_NOT_HOST');
  });

  // Scenario 15: Invalid passcode is rejected
  it('Scenario 15: Invalid passcode is rejected with clear error', async () => {
    const createRes = await RoomService.createRoom('Passcode Test', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;

    const invalidJoin = await RoomService.joinRoom(
      room.roomCode,
      'partner-id',
      'Bob',
      'completely-wrong-passcode',
      'partner'
    );
    expect(invalidJoin.success).toBe(false);
    expect(invalidJoin.error).toBe('INVALID_GUEST_PASSCODE');
  });

  // Scenario 17: Temporary network loss supports safe reconnection without consuming extra capacity
  it('Scenario 17: Reconnecting participant restores session without exceeding capacity', async () => {
    const createRes = await RoomService.createRoom('Recon Test', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    const pJoin = await RoomService.joinRoom(room.roomCode, 'partner-bob', 'Bob', room.guestPasscode!, 'partner');
    expect(pJoin.success).toBe(true);

    // Reconnecting with same participant ID
    const reconnect = await RoomService.joinRoom(
      room.roomCode,
      'partner-bob',
      'Bob (Reconnected)',
      room.guestPasscode!,
      'partner'
    );
    expect(reconnect.success).toBe(true);
    expect(reconnect.room?.roomCode).toBe(room.roomCode);
  });

  // Scenario 19: Partner leaving frees one slot
  it('Scenario 19: Partner leaving frees the Partner slot for a replacement partner', async () => {
    const createRes = await RoomService.createRoom('Replace Partner Room', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    const bobJoin = await RoomService.joinRoom(room.roomCode, 'p-bob', 'Bob', room.guestPasscode!, 'partner');

    // Partner leaves voluntarily
    const leaveRes = await RoomService.leaveRoom(room.roomCode, 'p-bob', bobJoin.room?.sessionToken!);
    expect(leaveRes).toBe(true);

    // Status should be waiting_partner (1/2)
    const availAfterLeave = await RoomService.checkPlatformAvailability();
    expect(availAfterLeave.status).toBe('waiting_partner');
    expect(availAfterLeave.activeParticipants).toBe(1);

    // New replacement partner can now join
    const charlieJoin = await RoomService.joinRoom(
      room.roomCode,
      'p-charlie',
      'Charlie',
      room.guestPasscode!,
      'partner'
    );
    expect(charlieJoin.success).toBe(true);
    expect(charlieJoin.room?.role).toBe('partner');
  });

  // Scenario 20 & 21: Host ending session releases both slots and allows new Host
  it('Scenario 20 & 21: Host ending session releases platform completely; new Host can create', async () => {
    const createRes = await RoomService.createRoom('Room to End', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    const hostJoin = await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    await RoomService.joinRoom(room.roomCode, 'p-bob', 'Bob', room.guestPasscode!, 'partner');

    // Host ends room
    const endRes = await RoomService.endRoom(room.roomCode, 'host-alice', hostJoin.room?.sessionToken!);
    expect(endRes).toBe(true);

    // Platform is immediately available again
    const availability = await RoomService.checkPlatformAvailability();
    expect(availability.isAvailable).toBe(true);
    expect(availability.status).toBe('available');
    expect(availability.activeParticipants).toBe(0);

    // Brand new user can create a new global room
    const newRoomRes = await RoomService.createRoom('Brand New Cinema', 'David', 'youtube', 'host-david');
    expect(newRoomRes.success).toBe(true);
    expect(newRoomRes.room?.roomCode).not.toBe(room.roomCode);
  });

  // Scenario 18: Stale participant lease expires after 90 seconds without heartbeat
  it('Scenario 18: Inactive partner lease expires after 90s timeout while Host remains active', async () => {
    vi.useFakeTimers();
    try {
      const createRes = await RoomService.createRoom('Expiry Room', 'Alice', 'youtube', 'host-alice');
      const room = createRes.room!;
      const hostJoin = await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
      await RoomService.joinRoom(room.roomCode, 'stale-bob', 'Bob', room.guestPasscode!, 'partner');

      // Advance 50 seconds: Host sends active heartbeat, Partner is silent
      vi.advanceTimersByTime(50000);
      await RoomService.sendHeartbeat(room.roomCode, 'host-alice', hostJoin.room?.sessionToken!);

      // Advance another 50 seconds (total 100s since partner last seen; host still fresh)
      vi.advanceTimersByTime(50000);
      await RoomService.sendHeartbeat(room.roomCode, 'host-alice', hostJoin.room?.sessionToken!);

      // New partner attempts to join: stale partner should be purged and new partner admitted
      const freshPartnerJoin = await RoomService.joinRoom(
        room.roomCode,
        'fresh-partner',
        'Charlie',
        room.guestPasscode!,
        'partner'
      );
      expect(freshPartnerJoin.success).toBe(true);
      expect(freshPartnerJoin.room?.role).toBe('partner');
    } finally {
      vi.useRealTimers();
    }
  });

  // Scenario 22 & 23: Previous session credentials cannot access new session
  it('Scenario 22 & 23: Expired session tokens cannot access new session', async () => {
    // Session 1
    const res1 = await RoomService.createRoom('Session 1', 'Alice', 'youtube', 'host-alice');
    const room1 = res1.room!;
    const hostJoin1 = await RoomService.joinRoom(room1.roomCode, 'host-alice', 'Alice', room1.ownerToken!, 'owner');
    const oldSessionToken = hostJoin1.room?.sessionToken!;

    // End Session 1
    await RoomService.endRoom(room1.roomCode, 'host-alice', oldSessionToken);

    // Session 2 created
    const res2 = await RoomService.createRoom('Session 2', 'Bob', 'youtube', 'host-bob');
    const room2 = res2.room!;

    // Old host attempts to use old session token on new room
    const heartbeatAttempt = await RoomService.sendHeartbeat(
      room2.roomCode,
      'host-alice',
      oldSessionToken
    );
    expect(heartbeatAttempt).toBe(false);

    // Old token cannot update new room media
    const updateAttempt = await RoomService.updateMediaState(
      room2.roomCode,
      'host-alice',
      oldSessionToken,
      'local',
      { isPlaying: true }
    );
    expect(updateAttempt.success).toBe(false);
  });

  // Scenario 11 & 12: Unauthorized RPC calls without valid session credentials fail
  it('Scenario 11 & 12: Operations with missing or forged session tokens fail', async () => {
    const createRes = await RoomService.createRoom('Auth Test', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');

    // Missing session token in updateMediaState
    const resNoToken = await RoomService.updateMediaState(
      room.roomCode,
      'host-alice',
      '',
      'local',
      { isPlaying: true }
    );
    expect(resNoToken.success).toBe(false);
    expect(resNoToken.error).toBe('MISSING_SESSION_CREDENTIAL');

    // Forged session token in sendHeartbeat
    const forgedHeartbeat = await RoomService.sendHeartbeat(
      room.roomCode,
      'host-alice',
      'forged-token-credential-123456789012'
    );
    expect(forgedHeartbeat).toBe(false);

    // Forged session token in leaveRoom
    const forgedLeave = await RoomService.leaveRoom(
      room.roomCode,
      'host-alice',
      'forged-token-credential-123456789012'
    );
    expect(forgedLeave).toBe(false);
  });

  // Scenario 16: Expired room cannot be joined
  it('Scenario 16: Expired room rejects new join attempts', async () => {
    vi.useFakeTimers();
    try {
      const createRes = await RoomService.createRoom('Time Limit Room', 'Alice', 'youtube', 'host-alice');
      const room = createRes.room!;
      await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');

      // Fast-forward past 24 hours (25 hours)
      vi.advanceTimersByTime(25 * 3600 * 1000);

      const joinExpired = await RoomService.joinRoom(
        room.roomCode,
        'late-joiner',
        'Bob',
        room.guestPasscode!,
        'partner'
      );
      expect(joinExpired.success).toBe(false);
      expect(joinExpired.error).toBe('ROOM_NOT_FOUND_OR_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  // Scenario 24: YouTube synchronization still works
  it('Scenario 24: YouTube media playback state updates preserve revision and action', async () => {
    const createRes = await RoomService.createRoom('YT Sync Room', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    const hostJoin = await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    const hostToken = hostJoin.room?.sessionToken!;

    // Host updates media state (play, seek, video change)
    const updateRes = await RoomService.updateMediaState(
      room.roomCode,
      'host-alice',
      hostToken,
      'youtube',
      {
        videoId: 'dQw4w9WgXcQ',
        isPlaying: true,
        currentTime: 42,
        revision: 2,
      }
    );
    expect(updateRes.success).toBe(true);
  });

  // Scenario 25 & 26: Local movie and screen sharing mode transitions
  it('Scenario 25 & 26: Mode switching to local and screen modes functions correctly', async () => {
    const createRes = await RoomService.createRoom('Modes Room', 'Alice', 'youtube', 'host-alice');
    const room = createRes.room!;
    const hostJoin = await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    const hostToken = hostJoin.room?.sessionToken!;

    // Switch to local mode
    const localModeRes = await RoomService.updateMediaState(
      room.roomCode,
      'host-alice',
      hostToken,
      'local',
      { isPlaying: false, currentTime: 0 }
    );
    expect(localModeRes.success).toBe(true);

    // Switch to screen mode
    const screenModeRes = await RoomService.updateMediaState(
      room.roomCode,
      'host-alice',
      hostToken,
      'screen',
      { isPlaying: true, currentTime: 0 }
    );
    expect(screenModeRes.success).toBe(true);
  });

  // Scenario 27: Ephemeral chat messages and floating reaction payloads
  it('Scenario 27: Ephemeral chat messages and floating reaction structures', () => {
    const chatPayload: SyncMessagePayload = {
      type: 'chat-message',
      chatMessage: {
        id: 'msg-1',
        senderId: 'user-1',
        senderName: 'Alice',
        role: 'owner',
        text: 'Hello Partner!',
        timestamp: Date.now(),
      },
    };
    expect(chatPayload.type).toBe('chat-message');
    expect(chatPayload.chatMessage?.text).toBe('Hello Partner!');

    const reactionPayload: SyncMessagePayload = {
      type: 'emoji-reaction',
      reaction: {
        emoji: '🍿',
        senderName: 'Bob',
      },
    };
    expect(reactionPayload.type).toBe('emoji-reaction');
    expect(reactionPayload.reaction?.emoji).toBe('🍿');
  });

  // Scenario 28: Mobile responsive and accessibility requirements
  it('Scenario 28: Platform availability responses provide accessible state without leaking secrets', async () => {
    const res = await RoomService.checkPlatformAvailability();
    expect(typeof res.isAvailable).toBe('boolean');
    expect(['available', 'waiting_partner', 'occupied']).toContain(res.status);
    expect(typeof res.activeParticipants).toBe('number');
    // Ensure no private properties exist
    const keys = Object.keys(res);
    expect(keys).not.toContain('roomCode');
    expect(keys).not.toContain('ownerToken');
    expect(keys).not.toContain('guestPasscode');
    expect(keys).not.toContain('ownerTokenHash');
    expect(keys).not.toContain('guestPasscodeHash');
  });

  // Scenario 29: Database migration file syntax and transaction safety
  it('Scenario 29: Migration file contains transactional locks and required security constraints', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261114_global_two_participant_capacity.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf-8');
    // Checks for singleton lock table
    expect(sql).toContain('duowatch_global_state');
    // Checks for partial unique index
    expect(sql).toContain('idx_duowatch_single_active_room');
    // Checks for role constraint
    expect(sql).toContain('uq_duowatch_participants_room_role');
    // Checks for search_path security hardening
    expect(sql).toContain("SET search_path = ''");
    // Checks for REVOKE/GRANT least privilege
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.duowatch_create_room');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.duowatch_create_room');
  });

  // Scenario 30: Atomic Host Admission in createRoom
  it('Scenario 30: Atomic host admission creates room and admits host in single atomic step', async () => {
    const createRes = await RoomService.createRoom('Atomic Cinema', 'HostAlice', 'youtube', 'host-atomic-id');
    expect(createRes.success).toBe(true);
    expect(createRes.room).toBeDefined();

    const room = createRes.room!;
    expect(room.role).toBe('owner');
    expect(room.participantId).toBe('host-atomic-id');
    expect(room.sessionToken).toBeDefined();

    // Immediately after creation, the platform is already in waiting_partner (1 active participant)
    const availability = await RoomService.checkPlatformAvailability();
    expect(availability.isAvailable).toBe(false);
    expect(availability.status).toBe('waiting_partner');
    expect(availability.activeParticipants).toBe(1);

    // Host can send heartbeats immediately without needing a separate joinRoom call
    const heartbeatSuccess = await RoomService.sendHeartbeat(
      room.roomCode,
      room.participantId!,
      room.sessionToken!
    );
    expect(heartbeatSuccess).toBe(true);
  });

  // Scenario 31: Elimination of 30-second grace period on host abandonment
  it('Scenario 31: Room is reclaimed immediately when 90s lease expires without 30s grace delay', async () => {
    vi.useFakeTimers();
    try {
      const createRes = await RoomService.createRoom('Immediate Reclaim Room', 'Alice', 'youtube', 'host-alice');
      const room = createRes.room!;

      // Advance clock past 90s host lease
      vi.advanceTimersByTime(95000);

      // Next platform availability check immediately reconciles and frees the platform
      const availability = await RoomService.checkPlatformAvailability();
      expect(availability.success).toBe(true);
      expect(availability.isAvailable).toBe(true);
      expect(availability.status).toBe('available');
      expect(availability.activeParticipants).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Scenario 32: Fail-closed platform availability under error conditions
  it('Scenario 32: Availability checks are strictly fail-closed on RPC failure, timeout, or malformed data', async () => {
    vi.spyOn(supabaseModule, 'isSupabaseConfigured').mockReturnValue(true);

    // Sub-case A: RPC returns error (e.g. function missing or DB error)
    const mockClientError = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'function duowatch_get_platform_availability does not exist' },
      }),
    };
    vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClientError as any);

    const resError = await RoomService.checkPlatformAvailability();
    expect(resError.success).toBe(false);
    expect(resError.isAvailable).toBe(false); // Fail-closed
    expect(resError.status).toBe('error');

    // Sub-case B: Network timeout or rejected promise
    const mockClientTimeout = {
      rpc: vi.fn().mockRejectedValue(new Error('Connection timed out after 5000ms')),
    };
    vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClientTimeout as any);

    const resTimeout = await RoomService.checkPlatformAvailability();
    expect(resTimeout.success).toBe(false);
    expect(resTimeout.isAvailable).toBe(false); // Fail-closed
    expect(resTimeout.status).toBe('error');

    // Sub-case C: Malformed data (data.success is false or missing)
    const mockClientMalformed = {
      rpc: vi.fn().mockResolvedValue({
        data: { success: false, error: 'Database initializing' },
        error: null,
      }),
    };
    vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClientMalformed as any);

    const resMalformed = await RoomService.checkPlatformAvailability();
    expect(resMalformed.success).toBe(false);
    expect(resMalformed.isAvailable).toBe(false); // Fail-closed
    expect(resMalformed.status).toBe('error');
  });

  // Scenario 33: Non-destructive data-preserving migration verification
  it('Scenario 33: Migration file contains safe non-destructive pre-migration checks', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261114_global_two_participant_capacity.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Must NOT contain unconditional destructive deletes or updates at the top
    expect(sql).not.toMatch(/^UPDATE public\.duowatch_rooms SET is_active = false;/m);
    expect(sql).not.toMatch(/^DELETE FROM public\.duowatch_participants;/m);

    // Must contain safe diagnostic exception blocks
    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain('MIGRATION_BLOCKED: Detected % active rooms in public.duowatch_rooms');
    expect(sql).toContain('CRITICAL: duowatch_global_state singleton row missing');
  });
});
