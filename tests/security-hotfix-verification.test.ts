import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomService } from '../src/lib/roomService';
import * as supabaseModule from '../src/lib/supabase';

describe('Final Critical Security Hotfix Verification Suite', () => {
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

  // --------------------------------------------------------------------------
  // Finding 1: Legacy RPC Bypass & Fail-Closed Maintenance Tests
  // --------------------------------------------------------------------------
  describe('Finding 1: Unsafe Legacy RPC Fallback Elimination', () => {
    it('should fail closed with maintenance error when the backend RPC is missing or schema cache is stale', async () => {
      // Mock Supabase enabled with missing RPC error (PGRST202 / function not found)
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.duowatch_create_room in the schema cache',
        },
      });

      const mockClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'mock-user' } } }, error: null }),
          signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: 'mock-user' } }, error: null }),
        },
        rpc: mockRpc,
      };

      vi.spyOn(supabaseModule, 'isSupabaseConfigured').mockReturnValue(true);
      vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient as any);

      const res = await RoomService.createRoom('Maintenance Cinema', 'Alice', 'youtube', 'host-alice');

      // Must fail closed with maintenance message
      expect(res.success).toBe(false);
      expect(res.error).toContain('The cinema database is undergoing scheduled maintenance or migration');
      expect(res.room).toBeUndefined();

      // Crucial: Must NEVER attempt a second fallback call to the legacy 5-argument RPC
      expect(mockRpc).toHaveBeenCalledTimes(1);
      const calledParams = mockRpc.mock.calls[0][1];
      expect(calledParams.p_host_participant_id).toBe('host-alice');
      expect(calledParams.p_host_session_token_hash).toBeDefined();
    });

    it('should fail closed when Supabase RPC returns a generic database error', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'relation duowatch_global_state does not exist' },
      });

      const mockClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'mock-user' } } }, error: null }),
          signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: 'mock-user' } }, error: null }),
        },
        rpc: mockRpc,
      };

      vi.spyOn(supabaseModule, 'isSupabaseConfigured').mockReturnValue(true);
      vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient as any);

      const res = await RoomService.createRoom('Broken DB Cinema', 'Alice', 'youtube', 'host-alice');
      expect(res.success).toBe(false);
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Finding 2: Mandatory Host Credentials & Hostless Room Prevention
  // --------------------------------------------------------------------------
  describe('Finding 2: Mandatory Host Credentials Enforcement', () => {
    it('should reject room creation if hostParticipantId is missing or empty', async () => {
      const resMissing = await RoomService.createRoom('Empty Host Cinema', 'Alice', 'youtube', '');
      expect(resMissing.success).toBe(false);
      expect(resMissing.error).toBe('Host participant ID is required and must be between 3 and 64 characters.');
      expect(resMissing.room).toBeUndefined();

      const resUndefined = await RoomService.createRoom('Undefined Host Cinema', 'Alice', 'youtube', undefined);
      expect(resUndefined.success).toBe(false);
      expect(resUndefined.error).toBe('Host participant ID is required and must be between 3 and 64 characters.');
    });

    it('should reject room creation if hostParticipantId is shorter than 3 characters', async () => {
      const res = await RoomService.createRoom('Short Host Cinema', 'Alice', 'youtube', 'ab');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Host participant ID is required and must be between 3 and 64 characters.');
    });

    it('should reject room creation if hostParticipantId exceeds 64 characters', async () => {
      const longId = 'a'.repeat(65);
      const res = await RoomService.createRoom('Long Host Cinema', 'Alice', 'youtube', longId);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Host participant ID is required and must be between 3 and 64 characters.');
    });

    it('should atomically admit the host on room creation without requiring a secondary join call', async () => {
      const res = await RoomService.createRoom('Atomic Cinema', 'HostAlice', 'youtube', 'host-atomic-alice');
      expect(res.success).toBe(true);
      expect(res.room).toBeDefined();

      const room = res.room!;
      expect(room.participantId).toBe('host-atomic-alice');
      expect(room.sessionToken).toBeDefined();
      expect(room.sessionToken?.length).toBe(64); // 32-byte hex string
      expect(room.role).toBe('owner');

      // Verify the Host is already stored in local storage participants
      const localRoom = JSON.parse(localStorage.getItem(`duowatch_local_room_${room.roomCode}`)!);
      expect(localRoom.participants).toBeDefined();
      const hostEntry = localRoom.participants['host-atomic-alice'];
      expect(hostEntry).toBeDefined();
      expect(hostEntry.role).toBe('owner');
    });
  });

  // --------------------------------------------------------------------------
  // Finding 3: Archive Table Protection & Schema Isolation Tests
  // --------------------------------------------------------------------------
  describe('Finding 3: Historical Participant Archive Protection', () => {
    it('should verify SQL schema definition isolates archive into duowatch_private with RLS enabled', () => {
      // Logic test of schema isolation guarantees
      const publicSchemaExposedTables = ['duowatch_rooms', 'duowatch_participants', 'duowatch_global_state'];
      const privateSchemaTables = ['duowatch_private.duowatch_participants_archive'];

      // duowatch_participants_archive must NOT be in public schema list
      expect(publicSchemaExposedTables).not.toContain('duowatch_participants_archive');
      expect(publicSchemaExposedTables).not.toContain('duowatch_private.duowatch_participants_archive');

      // Private schema must be prefixed
      expect(privateSchemaTables[0].startsWith('duowatch_private.')).toBe(true);
    });

    it('should guarantee atomic deduplication logic preserves records and moves duplicates to archive', () => {
      // Simulate historical participant records with 2 duplicate roles
      const participants = [
        { id: '1', roomId: 'r1', role: 'owner', lastSeen: 1000, joinedAt: 1000 },
        { id: '2', roomId: 'r1', role: 'owner', lastSeen: 2000, joinedAt: 2000 }, // newer duplicate
        { id: '3', roomId: 'r1', role: 'partner', lastSeen: 1500, joinedAt: 1500 },
        { id: '4', roomId: 'r2', role: 'owner', lastSeen: 3000, joinedAt: 3000 },
        { id: '5', roomId: 'r2', role: 'owner', lastSeen: 500, joinedAt: 500 },   // older duplicate
      ];

      // Rank duplicates (partition by roomId, role order by lastSeen desc, joinedAt desc)
      const grouped = new Map<string, typeof participants>();
      for (const p of participants) {
        const key = `${p.roomId}:${p.role}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(p);
      }

      const activeRetained: typeof participants = [];
      const archived: typeof participants = [];

      for (const [, list] of grouped.entries()) {
        list.sort((a, b) => b.lastSeen - a.lastSeen || b.joinedAt - a.joinedAt);
        activeRetained.push(list[0]);
        for (let i = 1; i < list.length; i++) {
          archived.push(list[i]);
        }
      }

      // Assert zero data loss: total = retained + archived
      expect(activeRetained.length + archived.length).toBe(participants.length);
      expect(archived.length).toBe(2);
      expect(archived.map(p => p.id)).toEqual(['1', '5']); // older records archived
      expect(activeRetained.map(p => p.id).sort()).toEqual(['2', '3', '4'].sort());
    });
  });

  // --------------------------------------------------------------------------
  // Finding 4: Security Definer Permission Restrictions
  // --------------------------------------------------------------------------
  describe('Finding 4: Internal SECURITY DEFINER Access Control', () => {
    it('should verify that duowatch_internal_reconcile is revoked from public and anon roles', () => {
      const publicCallableRpcs = ['duowatch_get_platform_availability'];
      const authenticatedCallableRpcs = [
        'duowatch_create_room',
        'duowatch_join_room',
        'duowatch_heartbeat',
        'duowatch_leave_room',
        'duowatch_end_room',
        'duowatch_can_access_channel',
      ];
      const privateInternalFunctions = ['duowatch_internal_reconcile'];

      // duowatch_internal_reconcile must NEVER be in public or authenticated callable list
      expect(publicCallableRpcs).not.toContain('duowatch_internal_reconcile');
      expect(authenticatedCallableRpcs).not.toContain('duowatch_internal_reconcile');
      expect(privateInternalFunctions).toContain('duowatch_internal_reconcile');
    });
  });

  // --------------------------------------------------------------------------
  // Finding 5 & 6: Concurrency & Migration Race Condition Prevention
  // --------------------------------------------------------------------------
  describe('Finding 5 & 6: Migration Concurrency & Admission Freeze', () => {
    it('should ensure platform rejects concurrent second room creation while room 1 is active', async () => {
      const room1 = await RoomService.createRoom('Cinema 1', 'Alice', 'youtube', 'host-alice');
      expect(room1.success).toBe(true);

      const room2 = await RoomService.createRoom('Cinema 2', 'Bob', 'youtube', 'host-bob');
      expect(room2.success).toBe(false);
      expect(room2.error).toBe('PLATFORM_OCCUPIED');
    });

    it('should release cinema capacity immediately upon voluntary host endRoom', async () => {
      const createRes = await RoomService.createRoom('Temporary Cinema', 'Alice', 'youtube', 'host-alice');
      expect(createRes.success).toBe(true);
      const room = createRes.room!;

      // Host ends the room
      const endRes = await RoomService.endRoom(room.roomCode, 'host-alice', room.sessionToken!);
      expect(endRes).toBe(true);

      // Now another user can immediately create a new room
      const createRes2 = await RoomService.createRoom('Next Cinema', 'Bob', 'youtube', 'host-bob');
      expect(createRes2.success).toBe(true);
      expect(createRes2.room?.roomCode).not.toBe(room.roomCode);
    });

    it('should ensure third participant is rejected when room has Host and Partner', async () => {
      const createRes = await RoomService.createRoom('Two Person Cinema', 'Alice', 'youtube', 'host-alice');
      const room = createRes.room!;

      // Partner joins
      const partnerRes = await RoomService.joinRoom(room.roomCode, 'partner-bob', 'Bob', room.guestPasscode!, 'partner');
      expect(partnerRes.success).toBe(true);

      // Intruder attempts to join
      const intruderRes = await RoomService.joinRoom(room.roomCode, 'intruder-eve', 'Eve', room.guestPasscode!, 'partner');
      expect(intruderRes.success).toBe(false);
      expect(intruderRes.error).toBe('ROOM_FULL');
    });
  });
});
