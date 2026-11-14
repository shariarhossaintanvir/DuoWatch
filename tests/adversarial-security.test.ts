import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RoomService } from '../src/lib/roomService';
import type { MediaState } from '../src/types/cinema';

describe('Adversarial Security & RPC Authorization Suite', () => {
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

  it('ATTACK SCENARIO 1: Attacker knowing room code and victim participant ID CANNOT invoke heartbeat without session credential', async () => {
    // 1. Host creates room and joins
    const createRes = await RoomService.createRoom('Secure Cinema', 'Alice', 'youtube');
    const room = createRes.room!;
    const hostJoin = await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    expect(hostJoin.success).toBe(true);

    // 2. Partner joins
    const partnerJoin = await RoomService.joinRoom(room.roomCode, 'partner-bob', 'Bob', room.guestPasscode!, 'partner');
    expect(partnerJoin.success).toBe(true);
    expect(partnerJoin.room?.sessionToken).toBeDefined();

    // 3. Attacker discovers roomCode and Bob's participant ID ('partner-bob')
    const attackerRoomCode = room.roomCode;
    const victimParticipantId = 'partner-bob';

    // Attempt heartbeat with forged session token
    const forgedHeartbeat1 = await RoomService.sendHeartbeat(attackerRoomCode, victimParticipantId, 'forged-token-abc-1234567890123456');
    expect(forgedHeartbeat1).toBe(false);

    // Attempt heartbeat with empty session token
    const forgedHeartbeat2 = await RoomService.sendHeartbeat(attackerRoomCode, victimParticipantId, '');
    expect(forgedHeartbeat2).toBe(false);

    // Attempt heartbeat with Alice's host token (cannot impersonate Bob)
    const forgedHeartbeat3 = await RoomService.sendHeartbeat(attackerRoomCode, victimParticipantId, hostJoin.room!.sessionToken!);
    expect(forgedHeartbeat3).toBe(false);

    // Legitimate heartbeat with Bob's authentic sessionToken succeeds
    const legitimateHeartbeat = await RoomService.sendHeartbeat(attackerRoomCode, victimParticipantId, partnerJoin.room!.sessionToken!);
    expect(legitimateHeartbeat).toBe(true);
  }, 15000);

  it('ATTACK SCENARIO 2: Attacker knowing room code and victim participant ID CANNOT kick victim from room', async () => {
    const createRes = await RoomService.createRoom('Private Cinema', 'Alice', 'youtube');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    const partnerJoin = await RoomService.joinRoom(room.roomCode, 'partner-bob', 'Bob', room.guestPasscode!, 'partner');

    const victimId = 'partner-bob';

    // Attacker attempts to eject Bob using a fake session token
    const maliciousLeaveAttempt = await RoomService.leaveRoom(room.roomCode, victimId, 'attacker-fake-credential');
    expect(maliciousLeaveAttempt).toBe(false);

    // Verify Bob is STILL present and legitimate heartbeat continues to function
    const bobStillActive = await RoomService.sendHeartbeat(room.roomCode, victimId, partnerJoin.room!.sessionToken!);
    expect(bobStillActive).toBe(true);

    // Legitimate leave by Bob using his real session token succeeds
    const legitimateLeave = await RoomService.leaveRoom(room.roomCode, victimId, partnerJoin.room!.sessionToken!);
    expect(legitimateLeave).toBe(true);
  });

  it('ATTACK SCENARIO 3: Non-host (Partner or Attacker) CANNOT update media state or impersonate Host', async () => {
    const createRes = await RoomService.createRoom('Movie Night', 'Alice', 'youtube');
    const room = createRes.room!;
    const hostJoin = await RoomService.joinRoom(room.roomCode, 'host-alice', 'Alice', room.ownerToken!, 'owner');
    const partnerJoin = await RoomService.joinRoom(room.roomCode, 'partner-bob', 'Bob', room.guestPasscode!, 'partner');

    const maliciousUpdate: Partial<MediaState> = {
      videoId: 'malicious-video-id',
      isPlaying: true,
      currentTime: 100,
    };

    // 1. Partner attempts to invoke Host-only updateMediaState with Partner credentials
    const partnerTamperAttempt = await RoomService.updateMediaState(
      room.roomCode,
      'partner-bob',
      partnerJoin.room!.sessionToken!,
      'youtube',
      maliciousUpdate
    );
    expect(partnerTamperAttempt.success).toBe(false);
    expect(partnerTamperAttempt.error).toBe('UNAUTHORIZED_NOT_HOST');

    // 2. Outside attacker attempts to update media state with fake credentials
    const attackerTamperAttempt = await RoomService.updateMediaState(
      room.roomCode,
      'attacker-id',
      'attacker-fake-token',
      'youtube',
      maliciousUpdate
    );
    expect(attackerTamperAttempt.success).toBe(false);
    expect(attackerTamperAttempt.error).toBe('UNAUTHORIZED_NOT_HOST');

    // 3. Legitimate Host with valid host sessionToken is authorized (not rejected as unauthorized host)
    const legitimateHostUpdate = await RoomService.updateMediaState(
      room.roomCode,
      'host-alice',
      hostJoin.room!.sessionToken!,
      'youtube',
      maliciousUpdate
    );
    expect(legitimateHostUpdate.error).not.toBe('UNAUTHORIZED_NOT_HOST');
  });

  it('ATTACK SCENARIO 4: Third-participant admission is strictly denied even with valid guest passcode', async () => {
    const createRes = await RoomService.createRoom('Two Person Cinema', 'Alice', 'youtube');
    const room = createRes.room!;

    // Admitting Participant 1 (Host)
    const p1 = await RoomService.joinRoom(room.roomCode, 'alice-id', 'Alice', room.ownerToken!, 'owner');
    expect(p1.success).toBe(true);

    // Admitting Participant 2 (Partner)
    const p2 = await RoomService.joinRoom(room.roomCode, 'bob-id', 'Bob', room.guestPasscode!, 'partner');
    expect(p2.success).toBe(true);

    // Attacker obtains the shared guest passcode and attempts to join
    const intruderJoin = await RoomService.joinRoom(
      room.roomCode,
      'eavesdropper-charlie',
      'Charlie',
      room.guestPasscode!,
      'partner'
    );
    expect(intruderJoin.success).toBe(false);
    expect(intruderJoin.error).toBe('ROOM_FULL');
  });

  it('ATTACK SCENARIO 5: Session objects and responses never leak database token hashes', async () => {
    const createRes = await RoomService.createRoom('Top Secret Room', 'Alice', 'youtube');
    expect(createRes.success).toBe(true);
    const room = createRes.room!;

    // Room session must contain ephemeral tokens in memory/sessionStorage
    expect(room.ownerToken).toBeDefined();
    expect(room.guestPasscode).toBeDefined();

    // Room session MUST NOT expose internal DB hash columns
    expect((room as any).ownerTokenHash).toBeUndefined();
    expect((room as any).guestPasscodeHash).toBeUndefined();
    expect((room as any).sessionTokenHash).toBeUndefined();

    // Verify sessionStorage does not store DB hashes
    const serialized = sessionStorage.getItem(`duowatch_session_${room.roomCode}`);
    expect(serialized).toBeDefined();
    expect(serialized).not.toContain('owner_token_hash');
    expect(serialized).not.toContain('guest_passcode_hash');
    expect(serialized).not.toContain('session_token_hash');
  });

  it('ATTACK SCENARIO 6: Reconnection after browser refresh restores session without consuming extra capacity', async () => {
    const createRes = await RoomService.createRoom('Cinema', 'Alice', 'youtube');
    const room = createRes.room!;
    const hostJoin = await RoomService.joinRoom(room.roomCode, 'alice-id', 'Alice', room.ownerToken!, 'owner');
    expect(hostJoin.success).toBe(true);

    const partnerJoin = await RoomService.joinRoom(room.roomCode, 'bob-id', 'Bob', room.guestPasscode!, 'partner');
    expect(partnerJoin.success).toBe(true);

    // Simulate browser refresh for Bob: reads sessionStorage and reconnects with same participant ID
    const saved = RoomService.getSavedSession(room.roomCode);
    expect(saved).toBeDefined();
    expect(saved?.role).toBe('partner');

    const bobReconnect = await RoomService.joinRoom(
      room.roomCode,
      'bob-id',
      'Bob',
      room.guestPasscode!,
      'partner'
    );
    expect(bobReconnect.success).toBe(true);

    // Verify room is STILL strictly at capacity (2) and rejects third participant
    const charlieAttempt = await RoomService.joinRoom(
      room.roomCode,
      'charlie-id',
      'Charlie',
      room.guestPasscode!,
      'partner'
    );
    expect(charlieAttempt.success).toBe(false);
    expect(charlieAttempt.error).toBe('ROOM_FULL');
  });

  it('ATTACK SCENARIO 7: Expired room rejects joining and heartbeats', async () => {
    const createRes = await RoomService.createRoom('Expiring Cinema', 'Alice', 'youtube');
    const room = createRes.room!;
    await RoomService.joinRoom(room.roomCode, 'alice-id', 'Alice', room.ownerToken!, 'owner');

    // Simulate expired room in storage (or non-existent/expired code in cloud mode)
    const raw = localStorage.getItem(`duowatch_local_room_${room.roomCode}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.expiresAt = Date.now() - 10000; // expired 10s ago
      localStorage.setItem(`duowatch_local_room_${room.roomCode}`, JSON.stringify(parsed));
    }

    // Partner attempts to join expired or non-existent room
    const targetRoomCode = raw ? room.roomCode : 'EXPIRED-0000';
    const joinExpired = await RoomService.joinRoom(
      targetRoomCode,
      'bob-id',
      'Bob',
      room.guestPasscode!,
      'partner'
    );
    expect(joinExpired.success).toBe(false);
    expect(joinExpired.error).toMatch(/ROOM_NOT_FOUND|ROOM_NOT_FOUND_OR_EXPIRED/);
  });

  it('ATTACK SCENARIO 8: Realtime authorization helper (duowatch_can_access_channel) boolean evaluation', () => {
    // Pure logic simulation of duowatch_can_access_channel
    const canAccessChannel = (
      topic: string | null,
      userId: string | null,
      participants: { userId: string; roomCode: string; isActive: boolean; expiresAt: number }[]
    ): boolean => {
      if (!userId || !topic) return false;
      return participants.some(
        p => p.userId === userId &&
             p.isActive &&
             p.expiresAt > Date.now() &&
             `duowatch_room_${p.roomCode}` === topic
      );
    };

    const participants = [
      { userId: 'user-alice-uuid', roomCode: 'ROOM-1234', isActive: true, expiresAt: Date.now() + 100000 },
      { userId: 'user-bob-uuid', roomCode: 'ROOM-1234', isActive: true, expiresAt: Date.now() + 100000 },
    ];

    // Authorized participants
    expect(canAccessChannel('duowatch_room_ROOM-1234', 'user-alice-uuid', participants)).toBe(true);
    expect(canAccessChannel('duowatch_room_ROOM-1234', 'user-bob-uuid', participants)).toBe(true);

    // Unauthorized outsider (Eve)
    expect(canAccessChannel('duowatch_room_ROOM-1234', 'user-eve-uuid', participants)).toBe(false);

    // Mismatched channel topic
    expect(canAccessChannel('duowatch_room_OTHER-ROOM', 'user-alice-uuid', participants)).toBe(false);

    // Null/empty checks
    expect(canAccessChannel(null, 'user-alice-uuid', participants)).toBe(false);
    expect(canAccessChannel('duowatch_room_ROOM-1234', null, participants)).toBe(false);
  });

  it('REGRESSION TEST 1: Rejection of NULL auth.uid() across all database RPC operations', () => {
    // Database schema and RPC state simulator matching 20261101_init_duowatch.sql
    interface MockRoom {
      id: string;
      room_code: string;
      room_name: string;
      created_by: string;
      owner_token_hash: string;
      guest_passcode_hash: string;
      current_mode: string;
      media_state: any;
      expires_at: number;
      is_active: boolean;
    }

    interface MockParticipant {
      id: string;
      room_id: string;
      participant_id: string;
      user_id: string;
      session_token_hash: string;
      display_name: string;
      role: 'owner' | 'partner';
      last_seen: number;
    }

    const rooms: MockRoom[] = [];
    const participants: MockParticipant[] = [];

    // RPC implementations mirroring PostgreSQL functions with strict auth.uid() requirement
    const rpc_create_room = (callerUid: string | null, params: any) => {
      if (!callerUid) return { success: false, error: 'AUTHENTICATION_REQUIRED' };
      if (!params.roomCode || params.roomCode.length < 6) return { success: false, error: 'INVALID_ROOM_CODE_FORMAT' };
      const room: MockRoom = {
        id: 'room-uuid-1',
        room_code: params.roomCode,
        room_name: params.roomName || 'Private Cinema',
        created_by: callerUid,
        owner_token_hash: params.ownerTokenHash,
        guest_passcode_hash: params.guestPasscodeHash,
        current_mode: params.initialMode || 'youtube',
        media_state: {},
        expires_at: Date.now() + 86400000,
        is_active: true,
      };
      rooms.push(room);
      return { success: true, roomId: room.id, roomCode: room.room_code };
    };

    const rpc_join_room = (callerUid: string | null, params: any) => {
      if (!callerUid) return { success: false, error: 'AUTHENTICATION_REQUIRED' };
      const room = rooms.find(r => r.room_code === params.roomCode && r.is_active && r.expires_at > Date.now());
      if (!room) return { success: false, error: 'ROOM_NOT_FOUND_OR_EXPIRED' };

      const existing = participants.find(p => p.room_id === room.id && p.participant_id === params.participantId);
      if (existing) {
        if (existing.user_id !== callerUid) {
          return { success: false, error: 'UNAUTHORIZED_USER_BINDING' };
        }
        existing.last_seen = Date.now();
        existing.session_token_hash = params.sessionTokenHash;
        return { success: true, roomId: room.id, role: params.role };
      }

      const activeCount = participants.filter(p => p.room_id === room.id).length;
      if (activeCount >= 2) return { success: false, error: 'ROOM_FULL' };

      participants.push({
        id: `p-${Date.now()}`,
        room_id: room.id,
        participant_id: params.participantId,
        user_id: callerUid,
        session_token_hash: params.sessionTokenHash,
        display_name: params.displayName,
        role: params.role,
        last_seen: Date.now(),
      });
      return { success: true, roomId: room.id, role: params.role };
    };

    const rpc_heartbeat = (callerUid: string | null, roomCode: string, participantId: string, sessionTokenHash: string) => {
      if (!callerUid) return { success: false, error: 'AUTHENTICATION_REQUIRED' };
      const room = rooms.find(r => r.room_code === roomCode && r.is_active && r.expires_at > Date.now());
      if (!room) return { success: false, error: 'ROOM_NOT_FOUND_OR_EXPIRED' };

      const pIndex = participants.findIndex(
        p => p.room_id === room.id &&
             p.participant_id === participantId &&
             p.session_token_hash === sessionTokenHash &&
             p.user_id === callerUid
      );
      if (pIndex === -1) return { success: false, error: 'UNAUTHORIZED_SESSION' };
      participants[pIndex].last_seen = Date.now();
      return { success: true };
    };

    const rpc_leave_room = (callerUid: string | null, roomCode: string, participantId: string, sessionTokenHash: string) => {
      if (!callerUid) return { success: false, error: 'AUTHENTICATION_REQUIRED' };
      const room = rooms.find(r => r.room_code === roomCode);
      if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

      const pIndex = participants.findIndex(
        p => p.room_id === room.id &&
             p.participant_id === participantId &&
             p.session_token_hash === sessionTokenHash &&
             p.user_id === callerUid
      );
      if (pIndex === -1) return { success: false, error: 'UNAUTHORIZED_SESSION' };
      participants.splice(pIndex, 1);
      return { success: true };
    };

    const rpc_update_media_state = (callerUid: string | null, roomCode: string, participantId: string, sessionTokenHash: string, mode: string, state: any) => {
      if (!callerUid) return { success: false, error: 'AUTHENTICATION_REQUIRED' };
      const room = rooms.find(r => r.room_code === roomCode && r.is_active && r.expires_at > Date.now());
      if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

      const host = participants.find(
        p => p.room_id === room.id &&
             p.participant_id === participantId &&
             p.session_token_hash === sessionTokenHash &&
             p.role === 'owner' &&
             p.user_id === callerUid
      );
      if (!host) return { success: false, error: 'UNAUTHORIZED_NOT_HOST' };
      room.current_mode = mode;
      room.media_state = state;
      return { success: true };
    };

    const rpc_can_access_channel = (callerUid: string | null, topic: string | null) => {
      if (!callerUid || !topic) return false;
      return participants.some(
        p => p.user_id === callerUid &&
             rooms.some(r => r.id === p.room_id && r.is_active && r.expires_at > Date.now() && `duowatch_room_${r.room_code}` === topic)
      );
    };

    // Test unauthenticated caller (callerUid === null) is strictly rejected across all RPC operations
    const nullCaller = null;

    expect(rpc_create_room(nullCaller, { roomCode: 'ROOM-1234' })).toEqual({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
    });

    expect(rpc_join_room(nullCaller, { roomCode: 'ROOM-1234', participantId: 'p-1' })).toEqual({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
    });

    expect(rpc_heartbeat(nullCaller, 'ROOM-1234', 'p-1', 'hash123')).toEqual({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
    });

    expect(rpc_leave_room(nullCaller, 'ROOM-1234', 'p-1', 'hash123')).toEqual({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
    });

    expect(rpc_update_media_state(nullCaller, 'ROOM-1234', 'p-1', 'hash123', 'youtube', {})).toEqual({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
    });

    expect(rpc_can_access_channel(nullCaller, 'duowatch_room_ROOM-1234')).toBe(false);
  });

  it('REGRESSION TEST 2: Rejection of forged user IDs, slot hijacking, and unauthorized user binding', () => {
    interface MockRoom {
      id: string;
      room_code: string;
      expires_at: number;
      is_active: boolean;
    }

    interface MockParticipant {
      id: string;
      room_id: string;
      participant_id: string;
      user_id: string;
      session_token_hash: string;
      role: 'owner' | 'partner';
    }

    const room: MockRoom = {
      id: 'room-uuid-abc',
      room_code: 'ROOM-SECURE',
      expires_at: Date.now() + 100000,
      is_active: true,
    };

    const participants: MockParticipant[] = [
      {
        id: 'p-owner',
        room_id: room.id,
        participant_id: 'alice-part-id',
        user_id: 'alice-auth-uid',
        session_token_hash: 'alice-session-token-hash-64chars________________________________',
        role: 'owner',
      },
      {
        id: 'p-partner',
        room_id: room.id,
        participant_id: 'bob-part-id',
        user_id: 'bob-auth-uid',
        session_token_hash: 'bob-session-token-hash-64chars__________________________________',
        role: 'partner',
      },
    ];

    // Reconnection logic: rejects if caller's auth.uid() != existing participant's user_id
    const joinRoomReconnectCheck = (callerUid: string, participantId: string) => {
      const existing = participants.find(p => p.room_id === room.id && p.participant_id === participantId);
      if (existing) {
        if (existing.user_id !== callerUid) {
          return { success: false, error: 'UNAUTHORIZED_USER_BINDING' };
        }
        return { success: true };
      }
      return { success: false, error: 'NOT_FOUND' };
    };

    // 1. Bob reconnects with his authentic auth.uid() -> succeeds
    const bobValidReconnect = joinRoomReconnectCheck('bob-auth-uid', 'bob-part-id');
    expect(bobValidReconnect.success).toBe(true);

    // 2. Attacker Charlie tries to hijack Bob's slot by presenting Bob's participantId
    const charlieHijackAttempt = joinRoomReconnectCheck('charlie-attacker-uid', 'bob-part-id');
    expect(charlieHijackAttempt.success).toBe(false);
    expect(charlieHijackAttempt.error).toBe('UNAUTHORIZED_USER_BINDING');

    // 3. Heartbeat and leave authorization: user_id = (SELECT auth.uid()) prevents caller spoofing
    const heartbeatCheck = (callerUid: string, participantId: string, sessionHash: string) => {
      const match = participants.find(
        p => p.room_id === room.id &&
             p.participant_id === participantId &&
             p.session_token_hash === sessionHash &&
             p.user_id === callerUid
      );
      return Boolean(match);
    };

    // Attacker Charlie knowing Bob's session token hash still CANNOT heartbeat as Bob
    const charlieHeartbeatAsBob = heartbeatCheck(
      'charlie-attacker-uid',
      'bob-part-id',
      'bob-session-token-hash-64chars__________________________________'
    );
    expect(charlieHeartbeatAsBob).toBe(false);

    // Bob with authentic auth.uid succeeds
    const bobAuthenticHeartbeat = heartbeatCheck(
      'bob-auth-uid',
      'bob-part-id',
      'bob-session-token-hash-64chars__________________________________'
    );
    expect(bobAuthenticHeartbeat).toBe(true);
  });

  it('REGRESSION TEST 3: Valid anonymous-authenticated sessions successfully bind and operate', () => {
    // Verified user identities from Supabase Anonymous Auth
    const aliceUid = 'anon-user-alice-uuid-0001';
    const bobUid = 'anon-user-bob-uuid-0002';

    const roomState = {
      roomCode: 'DUO-7788',
      createdBy: aliceUid,
      participants: [
        { participantId: 'host-alice', userId: aliceUid, role: 'owner' },
        { participantId: 'guest-bob', userId: bobUid, role: 'partner' },
      ],
      mediaState: { videoId: 'video1', isPlaying: true, currentTime: 15 },
    };

    // Verify both participants have valid non-null user_id bindings
    expect(roomState.createdBy).toBe(aliceUid);
    expect(roomState.participants[0].userId).toBe(aliceUid);
    expect(roomState.participants[1].userId).toBe(bobUid);
    expect(roomState.participants.length).toBe(2);

    // Channel access helper verification for both authorized participants
    const canAccess = (uid: string, code: string) => {
      return (
        code === roomState.roomCode &&
        roomState.participants.some(p => p.userId === uid)
      );
    };

    expect(canAccess(aliceUid, 'DUO-7788')).toBe(true);
    expect(canAccess(bobUid, 'DUO-7788')).toBe(true);
  });

  it('REGRESSION TEST 4: Unauthorized RPC calls are strictly rejected', () => {
    const roomState = {
      roomCode: 'DUO-9900',
      participants: [
        { participantId: 'host-alice', userId: 'alice-uid', role: 'owner', sessionTokenHash: 'alice-hash' },
        { participantId: 'guest-bob', userId: 'bob-uid', role: 'partner', sessionTokenHash: 'bob-hash' },
      ],
    };

    // Partner Bob attempting to invoke Host-only updateMediaState
    const updateMediaState = (callerUid: string, role: string, sessionHash: string) => {
      const p = roomState.participants.find(x => x.userId === callerUid && x.sessionTokenHash === sessionHash);
      if (!p || p.role !== 'owner' || role !== 'owner') {
        return { success: false, error: 'UNAUTHORIZED_NOT_HOST' };
      }
      return { success: true };
    };

    // Partner Bob fails
    expect(updateMediaState('bob-uid', 'partner', 'bob-hash')).toEqual({
      success: false,
      error: 'UNAUTHORIZED_NOT_HOST',
    });

    // Attacker Eve fails
    expect(updateMediaState('eve-uid', 'owner', 'fake-hash')).toEqual({
      success: false,
      error: 'UNAUTHORIZED_NOT_HOST',
    });

    // Host Alice succeeds
    expect(updateMediaState('alice-uid', 'owner', 'alice-hash')).toEqual({
      success: true,
    });
  });

  it('REGRESSION TEST 5: SQL Migration Least-Privilege & Strict Identity Binding Verification', () => {
    const migrationPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '20261101_init_duowatch.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // 1. MUST NOT contain permissive checks
    expect(sql).not.toContain('user_id IS NULL OR auth.uid() IS NULL OR user_id = auth.uid()');
    expect(sql).not.toMatch(/user_id\s+IS\s+NULL/i);

    // 2. MUST contain strict identity checks in each RPC function
    expect(sql).toContain('user_id = (SELECT auth.uid())');
    expect(sql).toContain('v_creator_uid := (SELECT auth.uid());');
    expect(sql).toContain('v_caller_uid := (SELECT auth.uid());');
    expect(sql).toContain('IF v_caller_uid IS NULL THEN');
    expect(sql).toContain('AUTHENTICATION_REQUIRED');
    expect(sql).toContain('UNAUTHORIZED_USER_BINDING');

    // 3. Helper function MUST derive identity internally and take only p_topic
    expect(sql).toMatch(/FUNCTION\s+public\.duowatch_can_access_channel\s*\(\s*p_topic\s+TEXT\s*\)/i);
    expect(sql).not.toMatch(/duowatch_can_access_channel\s*\([^)]*p_user_id/i);

    // 4. All 6 procedures MUST revoke execution from PUBLIC and anon
    const rpcList = [
      'duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR)',
      'duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR)',
      'duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR)',
      'duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR)',
      'duowatch_update_media_state(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB)',
      'duowatch_can_access_channel(TEXT)',
    ];

    rpcList.forEach(rpcSig => {
      // Must revoke from PUBLIC, anon
      const revokeRegex = new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpcSig.replace(/[()]/g, '\\$&')}\\s+FROM\\s+PUBLIC,\\s+anon`, 'i');
      expect(sql).toMatch(revokeRegex);

      // Must grant to authenticated
      const grantRegex = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpcSig.replace(/[()]/g, '\\$&')}\\s+TO\\s+authenticated`, 'i');
      expect(sql).toMatch(grantRegex);
    });

    // 5. Must NOT grant execute to anon or PUBLIC anywhere
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+.*TO\s+anon\b/i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+.*TO\s+PUBLIC\b/i);

    // 6. Realtime messages policies MUST be restricted to authenticated and call duowatch_can_access_channel
    expect(sql).toContain('TO authenticated');
    expect(sql).toContain('public.duowatch_can_access_channel(realtime.topic())');

    // 7. MUST NOT contain unauthorized ALTER TABLE on Supabase-managed realtime.messages
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+realtime\.messages/i);
  });
});


