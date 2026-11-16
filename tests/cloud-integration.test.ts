import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { sha256, generateRoomCode, generateSecureToken } from '../src/lib/crypto';

// Helper to safely load .env.local without exposing credentials
function loadEnvLocal(): { url?: string; anonKey?: string; fallback?: string } {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  });
  return {
    url: env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    fallback: env.VITE_ENABLE_LOCAL_FALLBACK || process.env.VITE_ENABLE_LOCAL_FALLBACK,
  };
}

describe('Real Supabase Cloud Integration & Live Security Verification Suite', () => {
  const env = loadEnvLocal();
  const isCloudConfigured = Boolean(
    env.url &&
    env.anonKey &&
    env.url.startsWith('https://') &&
    env.anonKey.length > 20
  );

  let clientAlice: SupabaseClient;
  let clientBob: SupabaseClient;
  let clientCharlie: SupabaseClient;

  let aliceUid: string;
  let bobUid: string;
  let charlieUid: string;

  const roomCode = generateRoomCode();
  let ownerToken: string;
  let guestPasscode: string;
  let ownerTokenHash: string;
  let guestPasscodeHash: string;

  let aliceSessionToken: string;
  let aliceSessionTokenHash: string;
  let bobSessionToken: string;
  let bobSessionTokenHash: string;

  const createIsolatedClient = (url: string, anonKey: string): SupabaseClient => {
    const memoryStore: Record<string, string> = {};
    return createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        storage: {
          getItem: (k: string) => memoryStore[k] || null,
          setItem: (k: string, v: string) => { memoryStore[k] = v; },
          removeItem: (k: string) => { delete memoryStore[k]; },
        },
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  };

  beforeAll(async () => {
    if (!isCloudConfigured) return;

    ownerToken = generateSecureToken(32);
    guestPasscode = generateSecureToken(16);
    ownerTokenHash = await sha256(ownerToken);
    guestPasscodeHash = await sha256(guestPasscode);

    aliceSessionToken = generateSecureToken(32);
    aliceSessionTokenHash = await sha256(aliceSessionToken);

    bobSessionToken = generateSecureToken(32);
    bobSessionTokenHash = await sha256(bobSessionToken);

    // Initialize 3 completely independent anonymous browser contexts
    clientAlice = createIsolatedClient(env.url!, env.anonKey!);
    clientBob = createIsolatedClient(env.url!, env.anonKey!);
    clientCharlie = createIsolatedClient(env.url!, env.anonKey!);
  });

  it('TASK 1 & 2: Environment verification (.env.local and VITE_ENABLE_LOCAL_FALLBACK=false)', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), '.env.local'))).toBe(true);
    expect(env.fallback).toBe('false');
  });

  it('TASK 3: Verify anonymous Supabase Auth works against actual cloud project', async () => {
    if (!isCloudConfigured) {
      console.warn('Skipping live cloud tests: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY not set in .env.local.');
      return;
    }

    // 1. Sign in Alice anonymously
    const aliceAuth = await clientAlice.auth.signInAnonymously();
    expect(aliceAuth.error).toBeNull();
    expect(aliceAuth.data.user?.id).toBeDefined();
    aliceUid = aliceAuth.data.user!.id;

    // 2. Sign in Bob anonymously
    const bobAuth = await clientBob.auth.signInAnonymously();
    expect(bobAuth.error).toBeNull();
    expect(bobAuth.data.user?.id).toBeDefined();
    bobUid = bobAuth.data.user!.id;

    // 3. Sign in Charlie anonymously
    const charlieAuth = await clientCharlie.auth.signInAnonymously();
    expect(charlieAuth.error).toBeNull();
    expect(charlieAuth.data.user?.id).toBeDefined();
    charlieUid = charlieAuth.data.user!.id;

    // Ensure distinct anonymous identities were generated
    expect(aliceUid).not.toBe(bobUid);
    expect(aliceUid).not.toBe(charlieUid);
    expect(bobUid).not.toBe(charlieUid);
  });

  it('TASK 4: Test duowatch_create_room against remote PostgreSQL', async () => {
    if (!isCloudConfigured) return;

    const { data, error } = await clientAlice.rpc('duowatch_create_room', {
      p_room_code: roomCode,
      p_room_name: 'Cloud Verification Cinema',
      p_owner_token_hash: ownerTokenHash,
      p_guest_passcode_hash: guestPasscodeHash,
      p_initial_mode: 'youtube',
      p_host_participant_id: 'alice-part-1',
      p_host_session_token_hash: aliceSessionTokenHash,
      p_host_display_name: 'Alice',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(true);
    expect(data.roomCode).toBe(roomCode);
    expect(data.roomId).toBeDefined();
  });

  it('TASK 5: Test duowatch_join_room with two independent anonymous identities', async () => {
    if (!isCloudConfigured) return;

    // Alice joins as Owner
    const aliceJoin = await clientAlice.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'alice-part-1',
      p_display_name: 'Alice',
      p_token_hash: ownerTokenHash,
      p_session_token_hash: aliceSessionTokenHash,
      p_role: 'owner',
    });

    expect(aliceJoin.error).toBeNull();
    expect(aliceJoin.data.success).toBe(true);
    expect(aliceJoin.data.role).toBe('owner');

    // Bob joins as Partner
    const bobJoin = await clientBob.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'bob-part-2',
      p_display_name: 'Bob',
      p_token_hash: guestPasscodeHash,
      p_session_token_hash: bobSessionTokenHash,
      p_role: 'partner',
    });

    expect(bobJoin.error).toBeNull();
    expect(bobJoin.data.success).toBe(true);
    expect(bobJoin.data.role).toBe('partner');
  });

  it('TASK 6: Verify third participant receives ROOM_FULL', async () => {
    if (!isCloudConfigured) return;

    // Charlie attempts to join with valid guest passcode
    const charlieJoin = await clientCharlie.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'charlie-intruder',
      p_display_name: 'Charlie',
      p_token_hash: guestPasscodeHash,
      p_session_token_hash: await sha256('charlie-session-token'),
      p_role: 'partner',
    });

    expect(charlieJoin.error).toBeNull();
    expect(charlieJoin.data.success).toBe(false);
    expect(charlieJoin.data.error).toBe('ROOM_FULL');
  });

  it('TASK 7: Verify unauthorized RPC calls fail', async () => {
    if (!isCloudConfigured) return;

    // 1. Partner Bob attempts to invoke Host-only updateMediaState
    const partnerTamper = await clientBob.rpc('duowatch_update_media_state', {
      p_room_code: roomCode,
      p_participant_id: 'bob-part-2',
      p_session_token_hash: bobSessionTokenHash,
      p_current_mode: 'local',
      p_media_state: { videoId: 'tampered', currentTime: 100 },
    });

    expect(partnerTamper.data.success).toBe(false);
    expect(partnerTamper.data.error).toBe('UNAUTHORIZED_NOT_HOST');

    // 2. Intruder Charlie attempts to kick Bob
    const intruderKick = await clientCharlie.rpc('duowatch_leave_room', {
      p_room_code: roomCode,
      p_participant_id: 'bob-part-2',
      p_session_token_hash: bobSessionTokenHash,
    });

    expect(intruderKick.data.success).toBe(false);
    expect(['UNAUTHORIZED_SESSION', 'UNAUTHORIZED_OR_NOT_FOUND']).toContain(intruderKick.data.error);

    // 3. Intruder Charlie attempts to hijack Bob's slot by reconnecting as Bob
    const charlieHijack = await clientCharlie.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'bob-part-2',
      p_display_name: 'CharlieAsBob',
      p_token_hash: guestPasscodeHash,
      p_session_token_hash: await sha256('fake-session'),
      p_role: 'partner',
    });

    expect(charlieHijack.data.success).toBe(false);
    expect(charlieHijack.data.error).toBe('UNAUTHORIZED_USER_BINDING');
  });

  it('TASK 8 & 10: Test Supabase Presence and Room Heartbeats', async () => {
    if (!isCloudConfigured) return;

    // Alice heartbeat succeeds
    const aliceHeartbeat = await clientAlice.rpc('duowatch_heartbeat', {
      p_room_code: roomCode,
      p_participant_id: 'alice-part-1',
      p_session_token_hash: aliceSessionTokenHash,
    });
    expect(aliceHeartbeat.data.success).toBe(true);

    // Bob heartbeat succeeds
    const bobHeartbeat = await clientBob.rpc('duowatch_heartbeat', {
      p_room_code: roomCode,
      p_participant_id: 'bob-part-2',
      p_session_token_hash: bobSessionTokenHash,
    });
    expect(bobHeartbeat.data.success).toBe(true);
  });

  it('TASK 8 & 9: Verify Private Realtime Channel Authorization & Broadcast Delivery', async () => {
    if (!isCloudConfigured) return;

    const channelTopic = `duowatch_room_${roomCode}`;
    const channelAlice = clientAlice.channel(channelTopic, { config: { private: true } });
    const channelBob = clientBob.channel(channelTopic, { config: { private: true } });

    let messageReceivedByBob: any = null;

    channelBob.on('broadcast', { event: 'test-ping' }, (payload) => {
      messageReceivedByBob = payload.payload;
    });

    // Subscribe both authorized participants
    await Promise.all([
      new Promise<void>((resolve) => {
        channelAlice.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
      }),
      new Promise<void>((resolve) => {
        channelBob.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
      }),
    ]);

    // Send broadcast from Alice to Bob
    await channelAlice.send({
      type: 'broadcast',
      event: 'test-ping',
      payload: { msg: 'hello-from-alice', timestamp: Date.now() },
    });

    // Wait for realtime message dispatch with polling
    const startWait = Date.now();
    while (!messageReceivedByBob && Date.now() - startWait < 4000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(messageReceivedByBob).toBeDefined();
    expect(messageReceivedByBob?.msg).toBe('hello-from-alice');

    // Cleanup channels
    clientAlice.removeChannel(channelAlice);
    clientBob.removeChannel(channelBob);
  });

  it('TASK 19: Clean up test rooms and sessions safely', async () => {
    if (!isCloudConfigured) return;

    // Bob leaves room safely first
    const bobLeave = await clientBob.rpc('duowatch_leave_room', {
      p_room_code: roomCode,
      p_participant_id: 'bob-part-2',
      p_session_token_hash: bobSessionTokenHash,
    });
    expect(bobLeave.data.success).toBe(true);

    // Alice leaves room safely (terminating room and freeing platform)
    const aliceLeave = await clientAlice.rpc('duowatch_leave_room', {
      p_room_code: roomCode,
      p_participant_id: 'alice-part-1',
      p_session_token_hash: aliceSessionTokenHash,
    });
    expect(aliceLeave.data.success).toBe(true);
  });
});
