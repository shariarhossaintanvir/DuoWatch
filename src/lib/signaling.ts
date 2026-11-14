import { getSupabaseClient, isSupabaseConfigured, getOrInitAnonymousSession, isLocalFallbackEnabled } from './supabase';
import type { WebRTCSignalPayload, ParticipantRole } from '../types/cinema';

export interface PeerInfo {
  id: string;
  role: ParticipantRole;
  displayName: string;
}

export type SignalHandler = (signal: WebRTCSignalPayload) => void;
export type BroadcastHandler = (payload: any) => void;
export type PeerJoinHandler = (peer: PeerInfo) => void;
export type PeerLeaveHandler = (peerId: string) => void;

export interface ISignalingService {
  connect(roomCode: string, participantId: string, role: ParticipantRole, displayName: string): Promise<void>;
  sendSignal(signal: WebRTCSignalPayload): Promise<void>;
  sendBroadcast(event: string, payload: any): Promise<void>;
  onSignal(handler: SignalHandler): () => void;
  onBroadcast(event: string, handler: BroadcastHandler): () => void;
  onPeerJoin(handler: PeerJoinHandler): () => void;
  onPeerLeave(handler: PeerLeaveHandler): () => void;
  getRoomCode(): string;
  disconnect(): void;
}

/**
 * Local Fallback Signaling Engine using HTML5 BroadcastChannel.
 * Fully compliant with WebRTC standards; allows two separate browser tabs/windows
 * to discover each other, exchange SDP offers/answers, trickle ICE candidates, and connect.
 */
class LocalBroadcastSignaling implements ISignalingService {
  private channel: BroadcastChannel | null = null;
  private roomCode: string = '';
  private participantId: string = '';
  private role: ParticipantRole = 'partner';
  private displayName: string = '';
  private signalHandlers: Set<SignalHandler> = new Set();
  private broadcastHandlers: Map<string, Set<BroadcastHandler>> = new Map();
  private peerJoinHandlers: Set<PeerJoinHandler> = new Set();
  private peerLeaveHandlers: Set<PeerLeaveHandler> = new Set();
  private announceInterval: number | null = null;
  private knownPeers: Map<string, PeerInfo> = new Map();

  async connect(roomCode: string, participantId: string, role: ParticipantRole, displayName: string): Promise<void> {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.role = role;
    this.displayName = displayName;

    const channelName = `duowatch_local_${roomCode}`;
    this.channel = new BroadcastChannel(channelName);

    this.channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.senderId === this.participantId) return;

      switch (data.type) {
        case 'signal':
          if (!data.targetId || data.targetId === this.participantId) {
            this.signalHandlers.forEach(h => h(data.payload));
          }
          break;

        case 'broadcast':
          const handlers = this.broadcastHandlers.get(data.event);
          if (handlers) {
            handlers.forEach(h => h(data.payload));
          }
          break;

        case 'presence_announce':
          this.handlePeerAnnounce(data.peer);
          // If we receive an announce, reply with our own announce so the other peer knows us
          this.sendDirectMessage({
            type: 'presence_reply',
            peer: {
              id: this.participantId,
              role: this.role,
              displayName: this.displayName,
            },
          });
          break;

        case 'presence_reply':
          this.handlePeerAnnounce(data.peer);
          break;

        case 'presence_leave':
          this.handlePeerLeave(data.peerId);
          break;
      }
    };

    // Announce presence immediately
    this.sendDirectMessage({
      type: 'presence_announce',
      peer: {
        id: this.participantId,
        role: this.role,
        displayName: this.displayName,
      },
    });

    // Periodic heartbeat announcement
    this.announceInterval = window.setInterval(() => {
      this.sendDirectMessage({
        type: 'presence_reply',
        peer: {
          id: this.participantId,
          role: this.role,
          displayName: this.displayName,
        },
      });
    }, 4000);
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  private handlePeerAnnounce(peer: PeerInfo) {
    if (peer.id === this.participantId) return;
    const isNew = !this.knownPeers.has(peer.id);
    this.knownPeers.set(peer.id, peer);
    if (isNew) {
      this.peerJoinHandlers.forEach(h => h(peer));
    }
  }

  private handlePeerLeave(peerId: string) {
    if (this.knownPeers.has(peerId)) {
      this.knownPeers.delete(peerId);
      this.peerLeaveHandlers.forEach(h => h(peerId));
    }
  }

  private sendDirectMessage(msg: any) {
    if (this.channel) {
      try {
        this.channel.postMessage({ ...msg, senderId: this.participantId });
      } catch (err) {
        console.error('Failed to postMessage on BroadcastChannel:', err);
      }
    }
  }

  async sendSignal(signal: WebRTCSignalPayload): Promise<void> {
    this.sendDirectMessage({
      type: 'signal',
      targetId: signal.targetId,
      payload: signal,
    });
  }

  async sendBroadcast(event: string, payload: any): Promise<void> {
    this.sendDirectMessage({
      type: 'broadcast',
      event,
      payload,
    });
  }

  onSignal(handler: SignalHandler): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  onBroadcast(event: string, handler: BroadcastHandler): () => void {
    if (!this.broadcastHandlers.has(event)) {
      this.broadcastHandlers.set(event, new Set());
    }
    this.broadcastHandlers.get(event)!.add(handler);
    return () => this.broadcastHandlers.get(event)?.delete(handler);
  }

  onPeerJoin(handler: PeerJoinHandler): () => void {
    this.peerJoinHandlers.add(handler);
    return () => this.peerJoinHandlers.delete(handler);
  }

  onPeerLeave(handler: PeerLeaveHandler): () => void {
    this.peerLeaveHandlers.add(handler);
    return () => this.peerLeaveHandlers.delete(handler);
  }

  disconnect(): void {
    if (this.announceInterval) {
      clearInterval(this.announceInterval);
      this.announceInterval = null;
    }
    if (this.channel) {
      this.sendDirectMessage({
        type: 'presence_leave',
        peerId: this.participantId,
      });
      this.channel.close();
      this.channel = null;
    }
    this.signalHandlers.clear();
    this.broadcastHandlers.clear();
    this.peerJoinHandlers.clear();
    this.peerLeaveHandlers.clear();
    this.knownPeers.clear();
  }
}

/**
 * Production Supabase Realtime Signaling Engine.
 * Leverages Supabase Broadcast Channels and Presence tracking with RLS.
 */
class SupabaseRealtimeSignaling implements ISignalingService {
  private channel: any = null;
  private roomCode: string = '';
  private participantId: string = '';
  private role: ParticipantRole = 'partner';
  private displayName: string = '';
  private signalHandlers: Set<SignalHandler> = new Set();
  private broadcastHandlers: Map<string, Set<BroadcastHandler>> = new Map();
  private peerJoinHandlers: Set<PeerJoinHandler> = new Set();
  private peerLeaveHandlers: Set<PeerLeaveHandler> = new Set();
  private knownPeers: Map<string, PeerInfo> = new Map();

  async connect(roomCode: string, participantId: string, role: ParticipantRole, displayName: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client is not configured.');
    }

    this.roomCode = roomCode;
    this.participantId = participantId;
    this.role = role;
    this.displayName = displayName;

    // Secure private Realtime authorization:
    // Uses Supabase Anonymous Auth so RLS policies on realtime.messages can authorize
    // only the two verified room participants to subscribe and broadcast.
    // Fail-closed: In cloud mode, never fall back to unauthenticated public channels.
    const anonymousUserId = await getOrInitAnonymousSession();
    if (!anonymousUserId) {
      throw new Error(
        'Supabase Anonymous Authentication failed. Private Realtime channels require anonymous sign-ins enabled in the Supabase Dashboard (Authentication -> Providers -> Anonymous). Connection aborted for security.'
      );
    }

    const channelName = `duowatch_room_${roomCode}`;
    this.channel = supabase.channel(channelName, {
      config: {
        private: true,
        broadcast: { ack: false, self: false },
        presence: { key: participantId },
      },
    });

    // 1. Listen for WebRTC signals
    this.channel.on('broadcast', { event: 'webrtc-signal' }, (payload: any) => {
      const signal: WebRTCSignalPayload = payload.payload;
      if (signal && signal.senderId !== this.participantId) {
        if (!signal.targetId || signal.targetId === this.participantId) {
          this.signalHandlers.forEach(h => h(signal));
        }
      }
    });

    // 2. Listen for generic broadcast events (media sync, chat fallback, emoji)
    this.channel.on('broadcast', { event: 'app-broadcast' }, (payload: any) => {
      const data = payload.payload;
      if (data && data.senderId !== this.participantId) {
        const handlers = this.broadcastHandlers.get(data.event);
        if (handlers) {
          handlers.forEach(h => h(data.payload));
        }
      }
    });

    // 3. Track Presence
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState();
      const currentPeerIds = new Set<string>();

      for (const key of Object.keys(state)) {
        if (key === this.participantId) continue;
        const presences = state[key];
        if (presences && presences.length > 0) {
          const p = presences[0];
          currentPeerIds.add(key);
          if (!this.knownPeers.has(key)) {
            const peerInfo: PeerInfo = {
              id: key,
              role: p.role || 'partner',
              displayName: p.displayName || 'Guest',
            };
            this.knownPeers.set(key, peerInfo);
            this.peerJoinHandlers.forEach(h => h(peerInfo));
          }
        }
      }

      // Check for left peers
      for (const [id] of this.knownPeers.entries()) {
        if (!currentPeerIds.has(id)) {
          this.knownPeers.delete(id);
          this.peerLeaveHandlers.forEach(h => h(id));
        }
      }
    });

    await this.channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        await this.channel.track({
          id: this.participantId,
          role: this.role,
          displayName: this.displayName,
          joinedAt: Date.now(),
        });
      }
    });
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  async sendSignal(signal: WebRTCSignalPayload): Promise<void> {
    if (this.channel) {
      await this.channel.send({
        type: 'broadcast',
        event: 'webrtc-signal',
        payload: signal,
      });
    }
  }

  async sendBroadcast(event: string, payload: any): Promise<void> {
    if (this.channel) {
      await this.channel.send({
        type: 'broadcast',
        event: 'app-broadcast',
        payload: {
          event,
          payload,
          senderId: this.participantId,
        },
      });
    }
  }

  onSignal(handler: SignalHandler): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  onBroadcast(event: string, handler: BroadcastHandler): () => void {
    if (!this.broadcastHandlers.has(event)) {
      this.broadcastHandlers.set(event, new Set());
    }
    this.broadcastHandlers.get(event)!.add(handler);
    return () => this.broadcastHandlers.get(event)?.delete(handler);
  }

  onPeerJoin(handler: PeerJoinHandler): () => void {
    this.peerJoinHandlers.add(handler);
    return () => this.peerJoinHandlers.delete(handler);
  }

  onPeerLeave(handler: PeerLeaveHandler): () => void {
    this.peerLeaveHandlers.add(handler);
    return () => this.peerLeaveHandlers.delete(handler);
  }

  disconnect(): void {
    if (this.channel) {
      const supabase = getSupabaseClient();
      if (supabase) {
        supabase.removeChannel(this.channel);
      }
      this.channel = null;
    }
    this.signalHandlers.clear();
    this.broadcastHandlers.clear();
    this.peerJoinHandlers.clear();
    this.peerLeaveHandlers.clear();
    this.knownPeers.clear();
  }
}

/**
 * Factory function creating the appropriate signaling service.
 * Automatically utilizes Supabase Realtime when configured,
 * or switches to Local BroadcastChannel with full capability when running offline/local testing.
 */
export function createSignalingService(): ISignalingService {
  if (isSupabaseConfigured()) {
    return new SupabaseRealtimeSignaling();
  }
  if (!isLocalFallbackEnabled()) {
    throw new Error('Supabase Cloud signaling is required (VITE_ENABLE_LOCAL_FALLBACK=false), but Supabase is not configured.');
  }
  return new LocalBroadcastSignaling();
}
