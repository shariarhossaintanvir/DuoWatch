import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { generateRoomCode, generateSecureToken, sha256 } from './crypto';
import type { MovieMode, ParticipantRole, MediaState, RoomSession } from '../types/cinema';

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
  participants: Map<string, {
    id: string;
    displayName: string;
    role: ParticipantRole;
    lastSeen: number;
  }>;
}

const LOCAL_STORAGE_KEY_PREFIX = 'duowatch_local_room_';

function getLocalRoom(roomCode: string): LocalRoomRecord | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${roomCode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    parsed.participants = new Map(Object.entries(parsed.participants || {}));
    return parsed;
  } catch (e) {
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

export class RoomService {
  /**
   * Create a new secure private cinema room.
   */
  public static async createRoom(
    roomName: string,
    _hostDisplayName: string,
    initialMode: MovieMode = 'youtube'
  ): Promise<CreateRoomResult> {
    const roomCode = generateRoomCode();
    const ownerToken = generateSecureToken(32);
    const guestPasscode = generateSecureToken(16);

    const ownerTokenHash = await sha256(ownerToken);
    const guestPasscodeHash = await sha256(guestPasscode);

    const initialMediaState: MediaState = {
      mode: initialMode,
      videoId: 'dQw4w9WgXcQ', // default demo video
      currentTime: 0,
      duration: 213,
      isPlaying: false,
      playbackRate: 1,
      lastUpdatedBy: 'owner',
      clientTimestamp: Date.now(),
    };

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('duowatch_create_room', {
          p_room_code: roomCode,
          p_room_name: roomName.trim() || 'Private Cinema',
          p_owner_token_hash: ownerTokenHash,
          p_guest_passcode_hash: guestPasscodeHash,
          p_initial_mode: initialMode,
        });

        if (error || !data || !data.success) {
          return { success: false, error: error?.message || data?.error || 'Database room creation failed.' };
        }

        const roomSession: RoomSession = {
          roomId: data.roomId,
          roomCode: data.roomCode,
          roomName: data.roomName,
          role: 'owner',
          ownerToken,
          guestPasscode,
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
    }

    // Local / Offline fallback creation
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

    saveLocalRoom(localRecord);

    const roomSession: RoomSession = {
      roomId,
      roomCode,
      roomName: localRecord.roomName,
      role: 'owner',
      ownerToken,
      guestPasscode,
      currentMode: initialMode,
      mediaState: initialMediaState,
      createdAt: localRecord.createdAt,
      expiresAt: localRecord.expiresAt,
    };

    sessionStorage.setItem(`duowatch_session_${roomCode}`, JSON.stringify(roomSession));
    return { success: true, room: roomSession };
  }

  /**
   * Join an existing cinema room as Owner or Partner.
   * Strictly enforces capacity: maximum 2 participants allowed.
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

    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('duowatch_join_room', {
          p_room_code: formattedCode,
          p_participant_id: participantId,
          p_display_name: displayName.trim() || (role === 'owner' ? 'Host' : 'Partner'),
          p_token_hash: tokenHash,
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
          guestPasscode: role === 'partner' ? tokenOrPasscode : undefined,
          currentMode: data.currentMode || 'youtube',
          mediaState: data.mediaState || {
            mode: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            currentTime: 0,
            duration: 213,
            isPlaying: false,
            playbackRate: 1,
            lastUpdatedBy: 'owner',
            clientTimestamp: Date.now(),
          },
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 3600 * 1000,
        };

        sessionStorage.setItem(`duowatch_session_${formattedCode}`, JSON.stringify(roomSession));
        return { success: true, room: roomSession };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // Local / Offline fallback join
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
    if (!existing && record.participants.size >= 2) {
      return { success: false, error: 'ROOM_FULL' };
    }

    // Register/update participant
    record.participants.set(participantId, {
      id: participantId,
      displayName: displayName.trim() || (role === 'owner' ? 'Host' : 'Partner'),
      role,
      lastSeen: now,
    });
    saveLocalRoom(record);

    const roomSession: RoomSession = {
      roomId: record.id,
      roomCode: record.roomCode,
      roomName: record.roomName,
      role,
      ownerToken: role === 'owner' ? tokenOrPasscode : undefined,
      guestPasscode: role === 'partner' ? tokenOrPasscode : undefined,
      currentMode: record.currentMode,
      mediaState: record.mediaState,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };

    sessionStorage.setItem(`duowatch_session_${formattedCode}`, JSON.stringify(roomSession));
    return { success: true, room: roomSession };
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
    } catch {}
  }
}
