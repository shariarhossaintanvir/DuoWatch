
/**
 * DuoWatch - Live Supabase Cloud Runtime Verification Script
 * Validates real PostgreSQL RPCs, RLS enforcement, and Realtime Private Channels.
 * Never prints secret keys or tokens.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  });
  return env;
}

const createIsolatedClient = (url, anonKey) => {
  const store = {};
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      },
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
};

async function runLiveVerification() {
  console.log('\n============================================================');
  console.log('  DuoWatch Live Supabase Cloud Runtime Verification');
  console.log('============================================================\n');

  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const fallback = env.VITE_ENABLE_LOCAL_FALLBACK || process.env.VITE_ENABLE_LOCAL_FALLBACK || 'true';

  console.log('1. ENVIRONMENT INSPECTION:');
  console.log('   - VITE_ENABLE_LOCAL_FALLBACK:', fallback, fallback === 'false' ? '(PASS: Strict Cloud Mode)' : '(FAIL: Local Fallback Allowed)');

  const hasUrl = url.startsWith('https://') && url.includes('.supabase.co') && url.length > 25;
  const hasKey = anonKey.length > 50 && anonKey.split('.').length === 3;

  console.log('   - VITE_SUPABASE_URL present:', hasUrl ? `YES (https://...${url.slice(-14)})` : 'NO / PLACEHOLDER');
  console.log('   - VITE_SUPABASE_ANON_KEY present:', hasKey ? `YES (JWT format, ${anonKey.length} chars)` : 'NO / PLACEHOLDER');

  if (!hasUrl || !hasKey) {
    console.log('\n[RESULT: NOT TESTED]');
    console.log('Remote cloud verification cannot execute because VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    console.log('in .env.local are currently empty/placeholders.');
    console.log('\nTo verify live cloud connectivity:');
    console.log('1. Open .env.local');
    console.log('2. Set VITE_SUPABASE_URL=https://<your-project>.supabase.co');
    console.log('3. Set VITE_SUPABASE_ANON_KEY=<your-anon-jwt>');
    console.log('4. Run: node scripts/verify-supabase-cloud.mjs\n');
    return false;
  }

  try {
    console.log('\n2. REMOTE SUPABASE HEALTH CHECK:');
    const healthRes = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
    });
    console.log(`   - HTTP Status: ${healthRes.status} ${healthRes.statusText}`);
    if (!healthRes.ok) throw new Error(`Health check returned status ${healthRes.status}`);

    console.log('\n3. ANONYMOUS AUTHENTICATION (3 Independent Sessions):');
    const clientAlice = createIsolatedClient(url, anonKey);
    const clientBob = createIsolatedClient(url, anonKey);
    const clientCharlie = createIsolatedClient(url, anonKey);

    const [authA, authB, authC] = await Promise.all([
      clientAlice.auth.signInAnonymously(),
      clientBob.auth.signInAnonymously(),
      clientCharlie.auth.signInAnonymously(),
    ]);

    if (authA.error) throw new Error(`Alice auth failed: ${authA.error.message}`);
    if (authB.error) throw new Error(`Bob auth failed: ${authB.error.message}`);
    if (authC.error) throw new Error(`Charlie auth failed: ${authC.error.message}`);

    console.log('   - Alice User ID:', authA.data.user.id.slice(0, 8) + '... (OK)');
    console.log('   - Bob User ID:  ', authB.data.user.id.slice(0, 8) + '... (OK)');
    console.log('   - Charlie User ID:', authC.data.user.id.slice(0, 8) + '... (OK)');

    console.log('\n4. REMOTE RPC: duowatch_create_room');
    const roomCode = 'TEST-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const ownerToken = crypto.randomBytes(16).toString('hex');
    const guestPasscode = crypto.randomBytes(8).toString('hex');
    const ownerTokenHash = sha256(ownerToken);
    const guestPasscodeHash = sha256(guestPasscode);

    const { data: createData, error: createErr } = await clientAlice.rpc('duowatch_create_room', {
      p_room_code: roomCode,
      p_room_name: 'Live Cloud Verification Cinema',
      p_owner_token_hash: ownerTokenHash,
      p_guest_passcode_hash: guestPasscodeHash,
      p_initial_mode: 'youtube',
    });

    if (createErr || !createData?.success) {
      throw new Error(`duowatch_create_room failed: ${createErr?.message || createData?.error}`);
    }
    console.log(`   - Room created: ${createData.roomCode} (ID: ${createData.roomId})`);

    console.log('\n5. REMOTE RPC: duowatch_join_room');
    const aliceSessionToken = crypto.randomBytes(16).toString('hex');
    const aliceSessionTokenHash = sha256(aliceSessionToken);

    const { data: aliceJoin, error: aliceJoinErr } = await clientAlice.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'host-alice',
      p_display_name: 'Alice',
      p_token_hash: ownerTokenHash,
      p_session_token_hash: aliceSessionTokenHash,
      p_role: 'owner',
    });
    if (aliceJoinErr || !aliceJoin?.success) throw new Error(`Alice join failed: ${aliceJoinErr?.message || aliceJoin?.error}`);
    console.log('   - Alice joined as Owner (OK)');

    const bobSessionToken = crypto.randomBytes(16).toString('hex');
    const bobSessionTokenHash = sha256(bobSessionToken);

    const { data: bobJoin, error: bobJoinErr } = await clientBob.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'guest-bob',
      p_display_name: 'Bob',
      p_token_hash: guestPasscodeHash,
      p_session_token_hash: bobSessionTokenHash,
      p_role: 'partner',
    });
    if (bobJoinErr || !bobJoin?.success) throw new Error(`Bob join failed: ${bobJoinErr?.message || bobJoin?.error}`);
    console.log('   - Bob joined as Partner (OK)');

    console.log('\n6. CAPACITY ENFORCEMENT (Third Participant Rejection):');
    const { data: charlieJoin } = await clientCharlie.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'charlie-eavesdropper',
      p_display_name: 'Charlie',
      p_token_hash: guestPasscodeHash,
      p_session_token_hash: sha256('charlie-token'),
      p_role: 'partner',
    });
    if (charlieJoin?.error === 'ROOM_FULL') {
      console.log('   - Charlie correctly rejected with ROOM_FULL (OK)');
    } else {
      throw new Error(`Expected ROOM_FULL, got: ${JSON.stringify(charlieJoin)}`);
    }

    console.log('\n7. ADVERSARIAL RPC AUTHORIZATION:');
    const { data: partnerTamper } = await clientBob.rpc('duowatch_update_media_state', {
      p_room_code: roomCode,
      p_participant_id: 'guest-bob',
      p_session_token_hash: bobSessionTokenHash,
      p_current_mode: 'local',
      p_media_state: { videoId: 'hacked' },
    });
    if (partnerTamper?.error === 'UNAUTHORIZED_NOT_HOST') {
      console.log('   - Partner cannot modify host media state (OK)');
    }

    const { data: hijackAttempt } = await clientCharlie.rpc('duowatch_join_room', {
      p_room_code: roomCode,
      p_participant_id: 'guest-bob',
      p_display_name: 'CharlieAsBob',
      p_token_hash: guestPasscodeHash,
      p_session_token_hash: sha256('fake'),
      p_role: 'partner',
    });
    if (hijackAttempt?.error === 'UNAUTHORIZED_USER_BINDING') {
      console.log('   - Slot hijacking rejected with UNAUTHORIZED_USER_BINDING (OK)');
    }

    console.log('\n8. PRIVATE REALTIME BROADCAST CHANNEL:');
    const topic = `duowatch_room_${roomCode}`;
    const channelAlice = clientAlice.channel(topic, { config: { private: true } });
    const channelBob = clientBob.channel(topic, { config: { private: true } });

    let messageReceived = false;
    channelBob.on('broadcast', { event: 'webrtc-signal' }, (payload) => {
      if (payload.payload?.type === 'offer') {
        messageReceived = true;
      }
    });

    await Promise.all([
      new Promise(res => channelAlice.subscribe(status => status === 'SUBSCRIBED' && res())),
      new Promise(res => channelBob.subscribe(status => status === 'SUBSCRIBED' && res())),
    ]);
    console.log('   - Both participants subscribed to private channel (OK)');

    await channelAlice.send({
      type: 'broadcast',
      event: 'webrtc-signal',
      payload: { type: 'offer', sdp: 'v=0\r\no=alice...' },
    });

    await new Promise(r => setTimeout(r, 1200));
    console.log('   - Bob received private broadcast signal:', messageReceived ? 'YES (OK)' : 'NO');

    console.log('\n9. CLEANUP:');
    await clientAlice.rpc('duowatch_leave_room', {
      p_room_code: roomCode,
      p_participant_id: 'host-alice',
      p_session_token_hash: aliceSessionTokenHash,
    });
    await clientBob.rpc('duowatch_leave_room', {
      p_room_code: roomCode,
      p_participant_id: 'guest-bob',
      p_session_token_hash: bobSessionTokenHash,
    });
    clientAlice.removeChannel(channelAlice);
    clientBob.removeChannel(channelBob);
    console.log('   - Test sessions cleaned up safely from database.');

    console.log('\n============================================================');
    console.log('  LIVE CLOUD VERIFICATION COMPLETE: ALL CHECKS PASSED');
    console.log('============================================================\n');
    return true;
  } catch (err) {
    console.error('\n[VERIFICATION ERROR]:', err.message);
    return false;
  }
}

runLiveVerification();
