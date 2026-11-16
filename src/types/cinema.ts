export type MovieMode = 'youtube' | 'local' | 'screen';

export type ParticipantRole = 'owner' | 'partner';

export type PlatformStatus = 'available' | 'waiting_partner' | 'occupied' | 'error';

export interface PlatformAvailability {
  success: boolean;
  isAvailable: boolean;
  status: PlatformStatus;
  activeParticipants: number;
  error?: string;
}

export type MediaSyncAction =
  | 'video_change'
  | 'play'
  | 'pause'
  | 'seek'
  | 'heartbeat'
  | 'state_snapshot';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface WebRTCStreamStats {
  timestamp: number;
  codec?: string;
  outbound?: {
    frameWidth: number;
    frameHeight: number;
    fps: number;
    bitrateBps: number;
    qualityLimitationReason: string;
    targetBitrateBps?: number;
    framesSent?: number;
    bytesSent?: number;
  };
  inbound?: {
    frameWidth: number;
    frameHeight: number;
    fps: number;
    bitrateBps: number;
    framesDecoded: number;
    framesDropped: number;
    packetsLost: number;
    jitter: number;
    framesReceived?: number;
    bytesReceived?: number;
  };
  rttMs?: number;
}

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  isOnline: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
  lastSeen?: number;
}

export interface MediaState {
  mode: MovieMode;
  videoId?: string; // YouTube video ID
  videoUrl?: string; // Canonical YouTube URL
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  lastUpdatedBy: string; // Participant ID
  clientTimestamp: number; // For drift calculation (Date.now())
  action?: MediaSyncAction;
  eventId?: string; // Unique event identifier for deduplication
  revision: number; // Monotonically increasing revision sequence number
}

export interface RoomSession {
  roomId: string;
  roomCode: string;
  roomName: string;
  role: ParticipantRole;
  ownerToken?: string; // Kept in memory/sessionStorage only for owner
  guestPasscode?: string;
  participantId?: string;
  sessionToken?: string; // Cryptographic per-participant session credential for authenticated RPC calls
  currentMode: MovieMode;
  mediaState: MediaState;
  createdAt: number;
  expiresAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  role: ParticipantRole;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  senderName: string;
  xOffset: number; // percentage across screen (20 - 80)
  createdAt: number;
}

export interface WebRTCSignalPayload {
  type: 'offer' | 'answer' | 'candidate' | 'renegotiate-request';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  senderId: string;
  targetId?: string;
  streamType?: 'video' | 'media';
}

export interface SyncMessagePayload {
  type:
  | 'media-sync'
  | 'chat-message'
  | 'emoji-reaction'
  | 'participant-state'
  | 'ping'
  | 'pong';
  action?: MediaSyncAction;
  mediaState?: Partial<MediaState>;
  eventId?: string;
  revision?: number;
  senderId?: string;
  fileMetadata?: {
    name: string;
    size: number;
    type: string;
    duration?: number;
  };
  chatMessage?: ChatMessage;
  reaction?: { emoji: string; senderName: string };
  participantState?: { isMuted: boolean; isSpeaking: boolean };
  timestamp: number;
  clientTimestamp?: number;
}
