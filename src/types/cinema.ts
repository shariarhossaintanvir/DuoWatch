export type MovieMode = 'youtube' | 'local' | 'screen';

export type ParticipantRole = 'owner' | 'partner';

export type ConnectionStatus = 
  | 'idle' 
  | 'connecting' 
  | 'connected' 
  | 'reconnecting' 
  | 'disconnected' 
  | 'failed';

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  isOnline: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  lastSeen?: number;
}

export interface MediaState {
  mode: MovieMode;
  videoId?: string; // YouTube video ID or URL
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  lastUpdatedBy: string; // Participant ID
  clientTimestamp: number; // For drift calculation (Date.now())
}

export interface RoomSession {
  roomId: string;
  roomCode: string;
  roomName: string;
  role: ParticipantRole;
  ownerToken?: string; // Kept in memory/sessionStorage only for owner
  guestPasscode?: string;
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
  streamType?: 'voice' | 'media';
}

export interface SyncMessagePayload {
  type: 
    | 'media-sync' 
    | 'chat-message' 
    | 'emoji-reaction' 
    | 'participant-state' 
    | 'ping' 
    | 'pong';
  mediaState?: Partial<MediaState>;
  chatMessage?: ChatMessage;
  reaction?: { emoji: string; senderName: string };
  participantState?: { isMuted: boolean; isSpeaking: boolean };
  timestamp: number;
  clientTimestamp?: number;
}
