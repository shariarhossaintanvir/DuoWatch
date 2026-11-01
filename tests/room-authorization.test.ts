import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../src/lib/roomService';

describe('Private Room System & Capacity Enforcement', () => {
  beforeEach(() => {
    // Setup in-memory mock for localStorage and sessionStorage if not present
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

  it('should create private room with Owner session and valid credentials', async () => {
    const res = await RoomService.createRoom('Private Cinema', 'Alice', 'youtube');
    expect(res.success).toBe(true);
    expect(res.room).toBeDefined();

    const room = res.room!;
    expect(room.roomCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(room.role).toBe('owner');
    expect(room.ownerToken).toBeDefined();
    expect(room.guestPasscode).toBeDefined();
  });

  it('should allow Partner to join with valid guest passcode', async () => {
    const createRes = await RoomService.createRoom('Date Night', 'Alice', 'youtube');
    const room = createRes.room!;

    const joinRes = await RoomService.joinRoom(
      room.roomCode,
      'partner-id-1',
      'Bob',
      room.guestPasscode!,
      'partner'
    );

    expect(joinRes.success).toBe(true);
    expect(joinRes.room).toBeDefined();
    expect(joinRes.room?.role).toBe('partner');
  });

  it('should reject joining with invalid guest passcode', async () => {
    const createRes = await RoomService.createRoom('Movie Night', 'Alice', 'youtube');
    const room = createRes.room!;

    const joinRes = await RoomService.joinRoom(
      room.roomCode,
      'malicious-user-id',
      'Attacker',
      'wrong-passcode-12345',
      'partner'
    );

    expect(joinRes.success).toBe(false);
    expect(joinRes.error).toBe('INVALID_GUEST_PASSCODE');
  });

  it('should reject third participant when room capacity of 2 is reached', async () => {
    const createRes = await RoomService.createRoom('Two Person Cinema', 'Alice', 'youtube');
    const room = createRes.room!;

    // 1. Participant 1 (Owner) joins
    const ownerJoin = await RoomService.joinRoom(
      room.roomCode,
      'owner-id-alice',
      'Alice',
      room.ownerToken!,
      'owner'
    );
    expect(ownerJoin.success).toBe(true);

    // 2. Participant 2 (Partner) joins
    const partnerJoin = await RoomService.joinRoom(
      room.roomCode,
      'partner-id-bob',
      'Bob',
      room.guestPasscode!,
      'partner'
    );
    expect(partnerJoin.success).toBe(true);

    // 3. Unauthorized Participant 3 attempts to join with valid passcode
    const intruderJoin = await RoomService.joinRoom(
      room.roomCode,
      'intruder-id-charlie',
      'Charlie',
      room.guestPasscode!,
      'partner'
    );

    expect(intruderJoin.success).toBe(false);
    expect(intruderJoin.error).toBe('ROOM_FULL');
  });

  it('should allow existing participant to reconnect without exceeding capacity', async () => {
    const createRes = await RoomService.createRoom('Two Person Cinema', 'Alice', 'youtube');
    const room = createRes.room!;

    // Owner joins
    await RoomService.joinRoom(room.roomCode, 'owner-id-alice', 'Alice', room.ownerToken!, 'owner');

    // Partner joins
    await RoomService.joinRoom(room.roomCode, 'partner-id-bob', 'Bob', room.guestPasscode!, 'partner');

    // Partner reloads page and reconnects with same participant ID
    const reconnectRes = await RoomService.joinRoom(
      room.roomCode,
      'partner-id-bob',
      'Bob',
      room.guestPasscode!,
      'partner'
    );

    expect(reconnectRes.success).toBe(true);
    expect(reconnectRes.room).toBeDefined();
  });
});
