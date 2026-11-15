import { getSupabaseClient, isSupabaseConfigured, getOrInitAnonymousSession, isLocalFallbackEnabled } from './supabase';
import { generateRoomCode, generateSecureToken, sha256 } from './crypto';
import type { MovieMode, ParticipantRole, MediaState, RoomSession, PlatformAvailability } from '../types/cinema';

export interface CreateRoomResult {
  success: boolean;
  room?: RoomSession;
  error?: string;
}

export interface JoinRoomResult {
  success: boolean;
  room?: RoomSession;
  error?: string;
}

interface LocalParticipantRecord {
  id: string;
  displayName: string;
  role: ParticipantRole;
  sessionTokenHash: string;
  lastSeen: number;
}

// In-memory / sessionStorage room cache for local fallback mode
interface LocalRoomRecord {
  id: string;
  roomCode: string;
  roomName: string;
  ownerTokenHash: string;
  guestPasscodeHash: string;
  currentMode: MovieMode;
  mediaState: MediaState;
  createdAt: number;
  expiresAt: number;
  participants: Map<string, LocalParticipantRecord>;
}

const LOCAL_STORAGE_KEY_PREFIX = 'duowatch_local_room_';
const LOCAL_ACTIVE_ROOM_KEY = 'duowatch_global_active_room_code';

function getLocalRoom(roomCode: string): LocalRoomRecord | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${roomCode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    parsed.participants = new Map(Object.entries(parsed.participants || {}));
    return parsed;
  } catch {
    return null;
  }
}

function saveLocalRoom(room: LocalRoomRecord): void {
  try {
    const serialized = {
      ...room,
      participants: Object.fromEntries(room.participants),
    };
    localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${room.roomCode}`, JSON.stringify(serialized));
  } catch (e) {
    console.error('Failed to save local room:', e);
  }
}

function cleanExpiredLocalRooms(): void {
  try {
    const activeCode = localStorage.getItem(LOCAL_ACTIVE_ROOM_KEY);
    if (!activeCode) return;
    const room = getLocalRoom(activeCode);
    if (!room) {
      localStorage.removeItem(LOCAL_ACTIVE_ROOM_KEY);
      return;
    }
    const now = Date.now();
    // 1. Check wall clock expiry (24h)
    if (now > room.expiresAt) {
      localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}${activeCode}`);
      localStorage.removeItem(LOCAL_ACTIVE_ROOM_KEY);
      return;
    }
    // 2. Check Host heartbeat (> 90s)
    let hasActiveHost = false;
    for (const p of room.participants.values()) {
      if (p.role === 'owner') {
        if (now - p.lastSeen <= 90000) {
          hasActiveHost = true;
        }
      }
    }
    // Atomic host creation guarantees host is admitted upon creation. If host is inactive > 90s, reclaim immediately
    if (!hasActiveHost) {
      localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}${activeCode}`);
      localStorage.removeItem(LOCAL_ACTIVE_ROOM_KEY);
      return;
    }
    // 3. Purge stale partner
    for (const [pId, p] of room.participants.entries()) {
      if (p.role === 'partner' && now - p.lastSeen > 90000) {
        room.participants.delete(pId);
      }
    }
    saveLocalRoom(room);
  } catch (e) {
    console.error('Error cleaning local rooms:', e);
  }
}

export class RoomService {
  /**
   * Check global platform availability.
   * Minimal sanitized public endpoint: reveals zero private session or media data.
   * Fail-closed: does not assume available if database or network fails.
   */
  public static async checkPlatformAvailability(): Promise<PlatformAvailability> {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        await getOrInitAnonymousSession();
        const { data, error } = await supabase.rpc('duowatch_get_platform_availability');
        if (error || !data || !data.success) {
          // Strictly fail-closed: do not assume platform is available on error
          return {
            success: false,
            isAvailable: false,
            status: 'error',
            activeParticipants: 0,
            error: error?.message || 'Platform availability service is temporarily unavailable.',
          };
        }
        return {
          success: true,
          isAvailable: Boolean(data.isAvailable),
          status: data.status || (data.isAvailable ? 'available' : 'occupied'),
          activeParticipants: data.activeParticipants ?? 0,
        };
      } catch (err: any) {
        return {
          success: false,
          isAvailable: false,
          status: 'error',
          activeParticipants: 0,
          error: err?.message || 'Platform availability check failed.',
        };
      }
    }

    // Local / Offline fallback check
    cleanExpiredLocalRooms();
    const activeCode = localStorage.getItem(LOCAL_ACTIVE_ROOM_KEY);
    if (!activeCode) {
      return {
        success: true,
        isAvailable: true,
        status: 'available',
        activeParticipants: 0,
      };
    }

    const room = getLocalRoom(activeCode);
    if (!room) {
      localStorage.removeItem(LOCAL_ACTIVE_ROOM_KEY);
      return {
        success: true,
        isAvailable: true,
        status: 'available',
        activeParticipants: 0,
      };
    }

    const count = room.participants.size;
    if (count <= 1) {
      return {
        success: true,
        isAvailable: false,
        status: 'waiting_partner',
        activeParticipants: count,
      };
    }

    return {
      success: true,
      isAvailable: false,
      status: 'occupied',
      activeParticipants: 2,
    };
  }

  /**
   * Create a new secure private cinema room with atomic host session credentials.
   * Strictly enforces GLOBAL_ACTIVE_ROOMS <= 1 invariant.
   */
  /**
   * Create a new secure private cinema room with atomic host session credentials.
   * Strictly enforces GLOBAL_ACTIVE_ROOMS <= 1 invariant.
   * Host participant credentials are mandatory: every room creation atomically admits exactly one Host.
   */
  public static async createRoom(
    roomName: string,
    hostDisplayName?: string,
    initialMode: MovieMode = 'youtube',
    hostParticipantId?: string
  ): Promise<CreateRoomResult> {
    // Enforce mandatory host participant credentials
    if (!hostParticipantId || hostParticipantId.trim().length < 3 || hostParticipantId.trim().length > 64) {
      return {
        success: false,
        error: 'Host participant ID is required and must be between 3 and 64 characters.',
      };
    }

    const finalHostParticipantId = hostParticipantId.trim();
    const finalHostDisplayName = hostDisplayName?.trim() || 'Host';
    const roomCode = generateRoomCode();
    const ownerToken = generateSecureToken(32);
    const guestPasscode = generateSecureToken(16);
    const hostSessionToken = generateSecureToken(32);

    const ownerTokenHash = await sha256(ownerToken);
    const guestPasscodeHash = await sha256(guestPasscode);
    const hostSessionTokenHash = await sha256(hostSessionToken);

    const initialMediaState: MediaState = {
      mode: initialMode,
      videoId: 'dQw4w9WgXcQ', // default demo video
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      currentTime: 0,
      duration: 213,
      isPlaying: false,
      playbackRate: 1,
      lastUpdatedBy: 'owner',
      clientTimestamp: Date.now(),
      revision: 0,
    };

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const anonUserId = await getOrInitAnonymousSession();
        if (!anonUserId) {
          return {
            success: false,
            error: 'Supabase Anonymous Authentication failed. Private rooms require anonymous sign-ins enabled in the Supabase Dashboard (Authentication -> Providers -> Anonymous).',
          };
        }

        // Strictly invoke the 8-argument RPC with atomic host admission.
        // No unsafe legacy 5-argument fallback: fail closed if database is unmigrated or in maintenance.
        const { data, error } = await supabase.rpc('duowatch_create_room', {
          p_room_code: roomCode,
          p_room_name: roomName.trim() || 'Private Cinema',
          p_owner_token_hash: ownerTokenHash,
          p_guest_passcode_hash: guestPasscodeHash,
          p_initial_mode: initialMode,
          p_host_participant_id: finalHostParticipantId,
          p_host_session_token_hash: hostSessionTokenHash,
          p_host_display_name: finalHostDisplayName,
        });

        if (error) {
          // Detect unmigrated backend, missing function, or PostgREST schema cache error
          if (
            error.message?.includes('schema cache') ||
            error.message?.includes('not find the function') ||
            error.code === 'PGRST202'
          ) {
            return {
              success: false,
              error: 'The cinema database is undergoing scheduled maintenance or migration. Please check back shortly.',
            };
          }
          return { success: false, error: error.message || 'Database room creation failed.' };
        }

        if (!data || !data.success) {
          return { success: false, error: data?.error || 'Database room creation failed.' };
        }

        const roomSession: RoomSession = {
          roomId: data.roomId,
          roomCode: data.roomCode,
          roomName: data.roomName,
          role: 'owner',
          ownerToken,
          guestPasscode,
          sessionToken: hostSessionToken,
          participantId: finalHostParticipantId,
          currentMode: initialMode,
          mediaState: initialMediaState,
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 3600 * 1000,
        };

        // Cache host session securely in sessionStorage
        sessionStorage.setItem(`duowatch_session_${roomCode}`, JSON.stringify(roomSession));

        return { success: true, room: roomSession };
      } catch (err: any) {
        console.error('Supabase create room RPC error:', err);
        return { success: false, error: err.message };
      }
    } else if (!isLocalFallbackEnabled()) {
      return {
        success: false,
        error: 'Supabase Cloud is required (VITE_ENABLE_LOCAL_FALLBACK=false), but Supabase is not configured. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
      };
    }

    // Local / Offline fallback creation with GLOBAL_ACTIVE_ROOMS <= 1 enforcement and atomic host admission
    cleanExpiredLocalRooms();
    const existingActiveCode = localStorage.getItem(LOCAL_ACTIVE_ROOM_KEY);
    if (existingActiveCode) {
      return { success: false, error: 'PLATFORM_OCCUPIED' };
    }

    const roomId = `room_${Date.now()}`;
    const localRecord: LocalRoomRecord = {
      id: roomId,
      roomCode,
      roomName: roomName.trim() || 'Private Cinema',
      ownerTokenHash,
      guestPasscodeHash,
      currentMode: initialMode,
      mediaState: initialMediaState,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
      participants: new Map(),
    };

    // Atomically admit host
    localRecord.participants.set(finalHostParticipantId, {
      id: finalHostParticipantId,
      sessionTokenHash: hostSessionTokenHash,
      displayName: finalHostDisplayName,
      role: 'owner',
      lastSeen: Date.now(),
    });

    saveLocalRoom(localRecord);
    localStorage.setItem(LOCAL_ACTIVE_ROOM_KEY, roomCode);

    const localRoomSession: RoomSession = {
      roomId,
      roomCode,
      roomName: localRecord.roomName,
      role: 'owner',
      ownerToken,
      guestPasscode,
      sessionToken: hostSessionToken,
      participantId: finalHostParticipantId,
      currentMode: initialMode,
      mediaState: initialMediaState,
      createdAt: localRecord.createdAt,
      expiresAt: localRecord.expiresAt,
    };

    sessionStorage.setItem(`duowatch_session_${roomCode}`, JSON.stringify(localRoomSession));
    return { success: true, room: localRoomSession };
  }

  /**
   * Join an existing cinema room as Owner or Partner.
   * Strictly enforces capacity: maximum 2 participants allowed globally.
   * Registers a server-verifiable session token credential for all subsequent RPC actions.
   */
  public static async joinRoom(
    roomCode: string,
    participantId: string,
    displayName: string,
    tokenOrPasscode: string,
    role: ParticipantRole
  ): Promise<JoinRoomResult> {
    const formattedCode = roomCode.trim().toUpperCase();
    const tokenHash = await sha256(tokenOrPasscode.trim());

    // Generate or reuse session token for authenticated RPC calls
    const saved = this.getSavedSession(formattedCode);
    const sessionToken = (saved && saved.role === role && saved.sessionToken)
      ? saved.sessionToken
      : generateSecureToken(32);
    const sessionTokenHash = await sha256(sessionToken);

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const anonUserId = await getOrInitAnonymousSession();
        if (!anonUserId) {
          return {
            success: false,
            error: 'Supabase Anonymous Authentication failed. Private rooms require anonymous sign-ins enabled in the Supabase Dashboard (Authentication -> Providers -> Anonymous).',
          };
        }

        const { data, error } = await supabase.rpc('duowatch_join_room', {
          p_room_code: formattedCode,
          p_participant_id: participantId,
          p_display_name: displayName.trim() || (role === 'owner' ? 'Host' : 'Partner'),
          p_token_hash: tokenHash,
          p_session_token_hash: sessionTokenHash,
          p_role: role,
        });

        if (error || !data || !data.success) {
          const errCode = error?.message || data?.error || 'Failed to join room';
          return { success: false, error: errCode };
        }

        const roomSession: RoomSession = {
          roomId: data.roomId,
          roomCode: data.roomCode,
          roomName: data.roomName || 'Private Cinema',
          role: data.role,
          ownerToken: role === 'owner' ? tokenOrPasscode : undefined,
          guestPasscode: role === 'partner' ? tokenOrPasscode : (saved?.guestPasscode || undefined),
          sessionToken,
          currentMode: data.currentMode || 'youtube',
          mediaState: data.mediaState ? { ...data.mediaState, revision: data.mediaState.revision ?? 0 } : {
            mode: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            currentTime: 0,
            duration: 213,
            isPlaying: false,
            playbackRate: 1,
            lastUpdatedBy: 'owner',
            clientTimestamp: Date.now(),
            revision: 0,
          },
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 3600 * 1000,
        };

        sessionStorage.setItem(`duowatch_session_${formattedCode}`, JSON.stringify(roomSession));
        return { success: true, room: roomSession };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else if (!isLocalFallbackEnabled()) {
      return {
        success: false,
        error: 'Supabase Cloud is required (VITE_ENABLE_LOCAL_FALLBACK=false), but Supabase is not configured. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
      };
    }

    // Local / Offline fallback join
    cleanExpiredLocalRooms();
    const record = getLocalRoom(formattedCode);
    if (!record) {
      return { success: false, error: 'ROOM_NOT_FOUND_OR_EXPIRED' };
    }

    if (Date.now() > record.expiresAt) {
      return { success: false, error: 'ROOM_NOT_FOUND_OR_EXPIRED' };
    }

    // Verify token hash
    if (role === 'owner') {
      if (record.ownerTokenHash !== tokenHash) {
        return { success: false, error: 'INVALID_OWNER_TOKEN' };
      }
    } else {
      if (record.guestPasscodeHash !== tokenHash) {
        return { success: false, error: 'INVALID_GUEST_PASSCODE' };
      }
    }

    // Check capacity: clean stale participants (> 90 seconds without heartbeat)
    const now = Date.now();
    for (const [pId, p] of record.participants.entries()) {
      if (now - p.lastSeen > 90000 && pId !== participantId) {
        record.participants.delete(pId);
      }
    }

    // Strict 2-Participant Capacity Enforcement
    const existing = record.participants.get(participantId);
    if (!existing) {
      if (record.participants.size >= 2) {
        return { success: false, error: 'ROOM_FULL' };
      }
      // Check role occupancy: at most 1 owner and 1 partner
      for (const p of record.participants.values()) {
        if (p.role === role) {
          return { success: false, error: 'ROOM_FULL' };
        }
      }
    }

    // Register/update participant with session token hash
    record.participants.set(participantId, {
      id: participantId,
      displayName: displayName.trim() || (role === 'owner' ? 'Host' : 'Partner'),
      role,
      sessionTokenHash,
      lastSeen: now,
    });
    saveLocalRoom(record);

    const roomSession: RoomSession = {
      roomId: record.id,
      roomCode: record.roomCode,
      roomName: record.roomName,
      role,
      ownerToken: role === 'owner' ? tokenOrPasscode : undefined,
      guestPasscode: role === 'partner' ? tokenOrPasscode : (saved?.guestPasscode || undefined),
      sessionToken,
      currentMode: record.currentMode,
      mediaState: record.mediaState,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };

    sessionStorage.setItem(`duowatch_session_${formattedCode}`, JSON.stringify(roomSession));
    return { success: true, room: roomSession };
  }

  /**
   * Send periodic heartbeat to keep participant registration active in database.
   * Authenticated: requires valid sessionToken matching participant record.
   */
  public static async sendHeartbeat(
    roomCode: string,
    participantId: string,
    sessionToken: string
  ): Promise<boolean> {
    if (!sessionToken) return false;
    const formattedCode = roomCode.trim().toUpperCase();
    const sessionTokenHash = await sha256(sessionToken);

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('duowatch_heartbeat', {
          p_room_code: formattedCode,
          p_participant_id: participantId,
          p_session_token_hash: sessionTokenHash,
        });
        return !error && Boolean(data?.success);
      } catch {
        return false;
      }
    } else if (!isLocalFallbackEnabled()) {
      return false;
    }

    // Local fallback heartbeat
    const record = getLocalRoom(formattedCode);
    if (record) {
      const p = record.participants.get(participantId);
      if (p && p.sessionTokenHash === sessionTokenHash) {
        p.lastSeen = Date.now();
        saveLocalRoom(record);
        return true;
      }
    }
    return false;
  }

  /**
   * Remove participant from room upon voluntary exit.
   * Host leaving terminates room and frees the platform.
   * Partner leaving frees the partner slot.
   */
  public static async leaveRoom(
    roomCode: string,
    participantId: string,
    sessionToken: string
  ): Promise<boolean> {
    if (!sessionToken) return false;
    const formattedCode = roomCode.trim().toUpperCase();
    const sessionTokenHash = await sha256(sessionToken);

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('duowatch_leave_room', {
          p_room_code: formattedCode,
          p_participant_id: participantId,
          p_session_token_hash: sessionTokenHash,
        });
        this.clearSession(formattedCode);
        return !error && Boolean(data?.success);
      } catch {
        this.clearSession(formattedCode);
        return false;
      }
    } else if (!isLocalFallbackEnabled()) {
      return false;
    }

    const record = getLocalRoom(formattedCode);
    if (record) {
      const p = record.participants.get(participantId);
      if (p && p.sessionTokenHash === sessionTokenHash) {
        if (p.role === 'owner') {
          // Host departure terminates room
          try {
            localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}${formattedCode}`);
            localStorage.removeItem(LOCAL_ACTIVE_ROOM_KEY);
          } catch { }
        } else {
          // Partner departure releases partner slot
          record.participants.delete(participantId);
          saveLocalRoom(record);
        }
        this.clearSession(formattedCode);
        return true;
      }
    }
    this.clearSession(formattedCode);
    return false;
  }

  /**
   * Explicitly terminate room and release both global participant slots (Host only).
   */
  public static async endRoom(
    roomCode: string,
    participantId: string,
    sessionToken: string
  ): Promise<boolean> {
    if (!sessionToken) return false;
    const formattedCode = roomCode.trim().toUpperCase();
    const sessionTokenHash = await sha256(sessionToken);

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('duowatch_end_room', {
          p_room_code: formattedCode,
          p_participant_id: participantId,
          p_session_token_hash: sessionTokenHash,
        });
        this.clearSession(formattedCode);
        return !error && Boolean(data?.success);
      } catch {
        this.clearSession(formattedCode);
        return false;
      }
    } else if (!isLocalFallbackEnabled()) {
      return false;
    }

    const record = getLocalRoom(formattedCode);
    if (record) {
      const p = record.participants.get(participantId);
      if (p && p.sessionTokenHash === sessionTokenHash && p.role === 'owner') {
        try {
          localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}${formattedCode}`);
          localStorage.removeItem(LOCAL_ACTIVE_ROOM_KEY);
        } catch { }
        this.clearSession(formattedCode);
        return true;
      }
    }
    this.clearSession(formattedCode);
    return false;
  }

  /**
   * Update room media state (Host only).
   * Authenticated: requires host sessionToken and verified owner role.
   */
  public static async updateMediaState(
    roomCode: string,
    participantId: string,
    sessionToken: string,
    currentMode: MovieMode,
    mediaState: Partial<MediaState>
  ): Promise<{ success: boolean; error?: string }> {
    if (!sessionToken) return { success: false, error: 'MISSING_SESSION_CREDENTIAL' };
    const formattedCode = roomCode.trim().toUpperCase();
    const sessionTokenHash = await sha256(sessionToken);

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('duowatch_update_media_state', {
          p_room_code: formattedCode,
          p_participant_id: participantId,
          p_session_token_hash: sessionTokenHash,
          p_current_mode: currentMode,
          p_media_state: mediaState,
        });
        if (error || !data || !data.success) {
          return { success: false, error: error?.message || data?.error || 'UNAUTHORIZED_NOT_HOST' };
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else if (!isLocalFallbackEnabled()) {
      return { success: false, error: 'CLOUD_CONFIGURATION_REQUIRED' };
    }

    const record = getLocalRoom(formattedCode);
    if (!record) return { success: false, error: 'ROOM_NOT_FOUND' };
    const p = record.participants.get(participantId);
    if (!p || p.sessionTokenHash !== sessionTokenHash || p.role !== 'owner') {
      return { success: false, error: 'UNAUTHORIZED_NOT_HOST' };
    }

    record.currentMode = currentMode;
    record.mediaState = { ...record.mediaState, ...mediaState };
    saveLocalRoom(record);
    return { success: true };
  }

  public static getSavedSession(roomCode: string): RoomSession | null {
    try {
      const raw = sessionStorage.getItem(`duowatch_session_${roomCode.toUpperCase()}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  public static clearSession(roomCode: string): void {
    try {
      sessionStorage.removeItem(`duowatch_session_${roomCode.toUpperCase()}`);
    } catch { }
  }
}
