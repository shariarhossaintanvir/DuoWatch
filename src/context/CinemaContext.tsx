import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type {
  RoomSession,
  Participant,
  ConnectionStatus,
  ChatMessage,
  FloatingReaction,
  MediaState,
  MediaSyncAction,
  MovieMode,
  SyncMessagePayload,
  WebRTCStreamStats
} from '../types/cinema';
import { createSignalingService } from '../lib/signaling';
import type { ISignalingService, PeerInfo } from '../lib/signaling';
import { WebRTCManager } from '../lib/webrtc';
import { generateId } from '../lib/crypto';
import { RoomService } from '../lib/roomService';

interface CinemaContextValue {
  session: RoomSession | null;
  myParticipantId: string;
  myDisplayName: string;
  participants: Participant[];
  connectionStatus: ConnectionStatus;
  rttMs: number;
  chatMessages: ChatMessage[];
  reactions: FloatingReaction[];
  mediaState: MediaState;
  remoteMediaStream: MediaStream | null;
  localMediaStream: MediaStream | null;
  streamStats: WebRTCStreamStats | null;
  cinemaLights: boolean;
  isSettingsOpen: boolean;
  isShareModalOpen: boolean;
  setCinemaLights: (dim: boolean | ((prev: boolean) => boolean)) => void;
  toggleCinemaLights: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openShareModal: () => void;
  closeShareModal: () => void;
  joinSession: (session: RoomSession, displayName: string) => Promise<boolean>;
  leaveRoom: () => void;
  changeMovieMode: (mode: MovieMode) => void;
  updateMediaState: (update: Partial<MediaState> & { action?: MediaSyncAction }) => void;
  playMedia: () => void;
  pauseMedia: () => void;
  seekMedia: (time: number) => void;
  changeVideo: (videoId: string) => void;
  sendMessage: (text: string) => void;
  sendReaction: (emoji: string) => void;
  setLocalMediaStream: (stream: MediaStream | null) => void;
  playerVolume: number;
  isPlayerMuted: boolean;
  setPlayerVolume: (volume: number) => void;
  togglePlayerMute: () => void;
}

const CinemaContext = createContext<CinemaContextValue | null>(null);

export const CinemaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSessionState] = useState<RoomSession | null>(null);
  const sessionRef = useRef<RoomSession | null>(null);
  const setSession = useCallback((s: RoomSession | null | ((prev: RoomSession | null) => RoomSession | null)) => {
    setSessionState(prev => {
      const next = typeof s === 'function' ? s(prev) : s;
      sessionRef.current = next;
      return next;
    });
  }, []);

  const [myParticipantId] = useState<string>(() => generateId());
  const [myDisplayName, setMyDisplayName] = useState<string>('Guest');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const lastConnectionStatusRef = useRef<ConnectionStatus>('idle');
  const [rttMs, setRttMs] = useState<number>(0);
  const [streamStats, setStreamStats] = useState<WebRTCStreamStats | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [cinemaLights, setCinemaLightsState] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);

  // Local Player Volume & Mute (Range 0-100, independent per participant)
  const [playerVolume, setPlayerVolumeState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('duowatch_player_volume');
      return saved !== null ? Math.max(0, Math.min(100, Number(saved))) : 100;
    } catch {
      return 100;
    }
  });

  const [isPlayerMuted, setIsPlayerMutedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('duowatch_player_muted') === 'true';
    } catch {
      return false;
    }
  });

  const setPlayerVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setPlayerVolumeState(clamped);
    try {
      localStorage.setItem('duowatch_player_volume', clamped.toString());
    } catch { }
  }, []);

  const togglePlayerMute = useCallback(() => {
    setIsPlayerMutedState(prev => {
      const next = !prev;
      try {
        localStorage.setItem('duowatch_player_muted', next.toString());
      } catch { }
      return next;
    });
  }, []);

  // Shared Cinema Media State (YouTube, Local Video, Screen Share)
  const [mediaState, setMediaStateInternal] = useState<MediaState>({
    mode: 'youtube',
    videoId: 'dQw4w9WgXcQ',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    currentTime: 0,
    duration: 212,
    isPlaying: false,
    playbackRate: 1,
    lastUpdatedBy: '',
    clientTimestamp: Date.now(),
    revision: 1,
  });

  const mediaStateRef = useRef<MediaState>(mediaState);
  const processedEventsRef = useRef<Set<string>>(new Set());

  // WebRTC Media Streams (Local File Video, Screen Share Video & Audio)
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const [localMediaStream, setLocalMediaStreamState] = useState<MediaStream | null>(null);
  const localMediaStreamRef = useRef<MediaStream | null>(null);

  const setMediaState = useCallback((s: MediaState | ((prev: MediaState) => MediaState)) => {
    setMediaStateInternal(prev => {
      const next = typeof s === 'function' ? s(prev) : s;
      mediaStateRef.current = next;
      return next;
    });
  }, []);

  const signalingRef = useRef<ISignalingService | null>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null);

  const addSystemMessage = useCallback((text: string) => {
    setChatMessages(prev => [
      ...prev.slice(-99),
      {
        id: generateId(),
        senderId: 'system',
        senderName: 'Cinema',
        role: 'owner',
        text,
        timestamp: Date.now(),
        isSystem: true,
      },
    ]);
  }, []);

  // Handle incoming data synchronization messages
  const handleDataMessage = useCallback((payload: SyncMessagePayload) => {
    switch (payload.type) {
      case 'media-sync':
        if (payload.mediaState) {
          const incoming = payload.mediaState;
          const action = payload.action;

          // Reject if originated from self
          if (incoming.lastUpdatedBy === myParticipantId) return;

          // Deduplicate events by eventId
          const eventId = payload.eventId || incoming.eventId;
          if (eventId) {
            if (processedEventsRef.current.has(eventId)) return;
            processedEventsRef.current.add(eventId);
            if (processedEventsRef.current.size > 500) {
              const first = processedEventsRef.current.values().next().value;
              if (first) processedEventsRef.current.delete(first);
            }
          }

          // Monotonic sequence / revision check: ignore older out-of-order events
          const incomingRevision = incoming.revision ?? payload.revision ?? 0;
          const currentRevision = mediaStateRef.current.revision || 0;
          if (incomingRevision > 0 && incomingRevision < currentRevision) {
            return;
          }

          setMediaState(prev => {
            // Video identity updates are accepted on explicit video_change OR state_snapshot
            const isVideoIdentityChange = action === 'video_change' || (action === 'state_snapshot' && Boolean(incoming.videoId));
            const newVideoId = (isVideoIdentityChange && incoming.videoId)
              ? incoming.videoId
              : prev.videoId;

            const newVideoUrl = (isVideoIdentityChange && incoming.videoUrl)
              ? incoming.videoUrl
              : (newVideoId ? `https://www.youtube.com/watch?v=${newVideoId}` : prev.videoUrl);

            // Heartbeat is position-only and must never resurrect playback if locally paused
            const nextIsPlaying = action === 'heartbeat'
              ? prev.isPlaying
              : (incoming.isPlaying ?? prev.isPlaying);

            const nextState: MediaState = {
              ...prev,
              ...incoming,
              isPlaying: nextIsPlaying,
              videoId: newVideoId,
              videoUrl: newVideoUrl,
              action: action,
              revision: Math.max(prev.revision || 0, incomingRevision),
              eventId: eventId || prev.eventId,
              clientTimestamp: payload.clientTimestamp || Date.now(),
            };

            // If video changed, update cached session in sessionStorage
            if (isVideoIdentityChange && sessionRef.current) {
              const updatedSession = { ...sessionRef.current, mediaState: nextState };
              sessionRef.current = updatedSession;
              try {
                sessionStorage.setItem(`duowatch_session_${updatedSession.roomCode}`, JSON.stringify(updatedSession));
              } catch { }

              // As Host, persist Partner's video change to database
              if (sessionRef.current.role === 'owner' && sessionRef.current.sessionToken) {
                RoomService.updateMediaState(
                  sessionRef.current.roomCode,
                  myParticipantId,
                  sessionRef.current.sessionToken,
                  nextState.mode,
                  nextState
                ).catch(e => console.warn('Non-blocking DB updateMediaState warning:', e));
              }
            }

            return nextState;
          });
        }
        break;

      case 'chat-message':
        if (payload.chatMessage) {
          setChatMessages(prev => [...prev.slice(-99), payload.chatMessage!]);
        }
        break;

      case 'emoji-reaction':
        if (payload.reaction) {
          const newReaction: FloatingReaction = {
            id: generateId(),
            emoji: payload.reaction.emoji,
            senderName: payload.reaction.senderName,
            xOffset: 20 + Math.random() * 60,
            createdAt: Date.now(),
          };
          setReactions(prev => [...prev.slice(-15), newReaction]);
        }
        break;
    }
  }, [myParticipantId, setMediaState]);

  // Join cinema room session
  const joinSession = useCallback(async (newSession: RoomSession, displayName: string): Promise<boolean> => {
    setSession(newSession);
    setMyDisplayName(displayName);
    setMediaState(newSession.mediaState);

    const me: Participant = {
      id: myParticipantId,
      displayName,
      role: newSession.role,
      isOnline: true,
    };
    setParticipants([me]);

    // Cleanup existing connections if any
    if (signalingRef.current) {
      signalingRef.current.disconnect();
    }
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
    }
    lastConnectionStatusRef.current = 'idle';

    // 1. Initialize Signaling
    const signaling = createSignalingService();
    signalingRef.current = signaling;

    // 2. Initialize WebRTC Manager
    const webrtc = new WebRTCManager({
      onConnectionStateChange: (status) => {
        setConnectionStatus(status);
        if (lastConnectionStatusRef.current !== status) {
          lastConnectionStatusRef.current = status;
          if (status === 'connected') {
            addSystemMessage('Peer connected securely via encrypted WebRTC.');
            // Automatically push any active local media stream to the newly connected peer
            if (localMediaStreamRef.current && webrtcRef.current) {
              webrtcRef.current.setMediaStream(localMediaStreamRef.current);
            }
          } else if (status === 'reconnecting') {
            addSystemMessage('Connection interrupted, attempting automatic reconnection...');
          } else if (status === 'failed') {
            addSystemMessage('Direct P2P connection could not be established. STUN only: NAT or firewall may block connection.');
          }
        }
      },
      onDataChannelOpen: () => {
        // Owner pushes current active media state snapshot to joining guest
        if (sessionRef.current?.role === 'owner') {
          const snapshotRevision = (mediaStateRef.current.revision || 0) + 1;
          const snapshotEventId = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          webrtc.sendDataMessage({
            type: 'media-sync',
            action: 'state_snapshot',
            eventId: snapshotEventId,
            revision: snapshotRevision,
            senderId: myParticipantId,
            mediaState: {
              ...mediaStateRef.current,
              revision: snapshotRevision,
              eventId: snapshotEventId,
            },
            timestamp: Date.now(),
            clientTimestamp: Date.now(),
          });
        }
      },
      onDataChannelClose: () => { },
      onDataMessage: handleDataMessage,
      onRemoteMediaStream: (stream) => {
        setRemoteMediaStream(stream);
      },
      onSendSignal: (signal) => {
        signaling.sendSignal(signal);
      },
      onRttUpdate: (rtt) => {
        setRttMs(rtt);
      },
      onStreamStats: (stats) => {
        setStreamStats(stats);
        if (stats.rttMs) {
          setRttMs(stats.rttMs);
        }
      },
    });

    webrtcRef.current = webrtc;
    webrtc.setLocalParticipantId(myParticipantId);

    signaling.onSignal((signal) => {
      webrtc.handleSignal(signal);
    });

    signaling.onBroadcast('media-sync', (payload) => {
      handleDataMessage({
        type: 'media-sync',
        action: payload.action,
        mediaState: payload.mediaState,
        timestamp: payload.timestamp || Date.now(),
        clientTimestamp: payload.clientTimestamp,
      });
    });

    signaling.onBroadcast('chat-message', (payload) => {
      handleDataMessage({ type: 'chat-message', chatMessage: payload, timestamp: Date.now() });
    });

    signaling.onBroadcast('emoji-reaction', (payload) => {
      handleDataMessage({ type: 'emoji-reaction', reaction: payload, timestamp: Date.now() });
    });

    signaling.onPeerJoin((peer: PeerInfo) => {
      setParticipants(prev => {
        const others = prev.filter(p => p.id !== peer.id);
        return [
          ...others,
          {
            id: peer.id,
            displayName: peer.displayName,
            role: peer.role,
            isOnline: true,
          },
        ];
      });

      addSystemMessage(`${peer.displayName} (${peer.role === 'owner' ? 'Host' : 'Partner'}) joined the cinema.`);

      // Owner initiates the WebRTC offer when Partner connects
      if (sessionRef.current?.role === 'owner') {
        webrtc.initialize(myParticipantId, peer.id, true);
        webrtc.startAsInitiator();
      } else {
        webrtc.initialize(myParticipantId, peer.id, false);
      }

      // Automatically pipe active local media stream to WebRTC if host already selected video/screen
      if (localMediaStreamRef.current) {
        webrtc.setMediaStream(localMediaStreamRef.current);
      }
    });

    signaling.onPeerLeave((peerId: string) => {
      setParticipants(prev =>
        prev.map(p => p.id === peerId ? { ...p, isOnline: false } : p)
      );
      addSystemMessage('Partner left or disconnected.');
      setConnectionStatus('disconnected');
    });

    try {
      await signaling.connect(newSession.roomCode, myParticipantId, newSession.role, displayName);
      addSystemMessage(`Joined room ${newSession.roomCode} as ${newSession.role === 'owner' ? 'Owner (Host)' : 'Partner'}.`);
      return true;
    } catch (err: any) {
      console.error('Failed to connect to signaling service:', err);
      addSystemMessage(`Signaling connection error: ${err.message}`);
      return false;
    }
  }, [myParticipantId, handleDataMessage, addSystemMessage, setSession, setMediaState]);

  // Periodic Database Heartbeat (every 15 seconds to maintain 90s server lease)
  useEffect(() => {
    if (!session || !session.sessionToken) return;
    const interval = window.setInterval(() => {
      RoomService.sendHeartbeat(session.roomCode, myParticipantId, session.sessionToken!);
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [session, myParticipantId]);

  // Leave room and cleanup
  const leaveRoom = useCallback(() => {
    if (sessionRef.current) {
      if (sessionRef.current.sessionToken) {
        if (sessionRef.current.role === 'owner') {
          RoomService.endRoom(sessionRef.current.roomCode, myParticipantId, sessionRef.current.sessionToken);
        } else {
          RoomService.leaveRoom(sessionRef.current.roomCode, myParticipantId, sessionRef.current.sessionToken);
        }
      }
      RoomService.clearSession(sessionRef.current.roomCode);
    }
    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getTracks().forEach(t => t.stop());
      localMediaStreamRef.current = null;
      setLocalMediaStreamState(null);
    }
    if (signalingRef.current) {
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
      webrtcRef.current = null;
    }
    lastConnectionStatusRef.current = 'idle';
    setStreamStats(null);
    setSession(null);
    setParticipants([]);
    setConnectionStatus('idle');
    setChatMessages([]);
    setReactions([]);
  }, [myParticipantId, setSession]);

  // Mode change (Owner authoritative)
  const changeMovieMode = useCallback((mode: MovieMode) => {
    if (!sessionRef.current || sessionRef.current.role !== 'owner') return;

    const nextRevision = (mediaStateRef.current.revision || 0) + 1;
    const eventId = `mode_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const newMediaState: MediaState = {
      ...mediaStateRef.current,
      mode,
      currentTime: 0,
      isPlaying: false,
      revision: nextRevision,
      eventId,
      lastUpdatedBy: myParticipantId,
      clientTimestamp: Date.now(),
    };

    setMediaState(newMediaState);

    // Persist mode to session cache
    const currentSession = sessionRef.current;
    if (currentSession) {
      const updatedSession: RoomSession = {
        ...currentSession,
        currentMode: mode,
        mediaState: newMediaState,
      };
      setSession(updatedSession);
      try {
        sessionStorage.setItem(`duowatch_session_${currentSession.roomCode}`, JSON.stringify(updatedSession));
      } catch { }

      // Fire-and-forget persist to database
      if (currentSession.sessionToken) {
        RoomService.updateMediaState(
          currentSession.roomCode,
          myParticipantId,
          currentSession.sessionToken,
          mode,
          newMediaState
        ).catch(e => console.warn('Non-blocking DB updateMediaState warning:', e));
      }
    }

    const syncPayload: SyncMessagePayload = {
      type: 'media-sync',
      action: 'video_change',
      eventId,
      revision: nextRevision,
      senderId: myParticipantId,
      mediaState: newMediaState,
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    if (webrtcRef.current) {
      webrtcRef.current.sendDataMessage(syncPayload);
    }
    if (signalingRef.current) {
      signalingRef.current.sendBroadcast('media-sync', syncPayload);
    }

    addSystemMessage(`Cinema mode switched to ${mode.toUpperCase()} by Host.`);
  }, [myParticipantId, setMediaState, setSession, addSystemMessage]);

  // Update Media State (Shared playback controls for both Host and Partner)
  const updateMediaState = useCallback((update: Partial<MediaState> & { action?: MediaSyncAction }) => {
    const currentSession = sessionRef.current;
    if (!currentSession || (currentSession.role !== 'owner' && currentSession.role !== 'partner')) return;

    const { action, ...stateUpdate } = update;
    const prev = mediaStateRef.current;
    const nextRevision = (prev.revision || 0) + 1;
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Video ID preservation: only explicit video_change or state_snapshot updates videoId!
    const isVideoIdentityChange = action === 'video_change' || (action === 'state_snapshot' && Boolean(stateUpdate.videoId));
    const effectiveVideoId = (isVideoIdentityChange && stateUpdate.videoId)
      ? stateUpdate.videoId
      : prev.videoId;

    const effectiveVideoUrl = (isVideoIdentityChange && stateUpdate.videoUrl)
      ? stateUpdate.videoUrl
      : (effectiveVideoId ? `https://www.youtube.com/watch?v=${effectiveVideoId}` : prev.videoUrl);

    const updatedState: MediaState = {
      ...prev,
      ...stateUpdate,
      videoId: effectiveVideoId,
      videoUrl: effectiveVideoUrl,
      action: action,
      revision: nextRevision,
      eventId,
      lastUpdatedBy: myParticipantId,
      clientTimestamp: Date.now(),
    };

    setMediaState(updatedState);

    // If video changed, update cached session in sessionStorage
    if (isVideoIdentityChange) {
      const updatedSession: RoomSession = {
        ...currentSession,
        mediaState: updatedState,
      };
      setSession(updatedSession);
      try {
        sessionStorage.setItem(`duowatch_session_${currentSession.roomCode}`, JSON.stringify(updatedSession));
      } catch { }

      // If Host, asynchronously persist video change to Supabase PostgreSQL room record
      if (currentSession.role === 'owner' && currentSession.sessionToken) {
        RoomService.updateMediaState(
          currentSession.roomCode,
          myParticipantId,
          currentSession.sessionToken,
          updatedState.mode,
          updatedState
        ).catch(e => console.warn('Non-blocking DB updateMediaState warning:', e));
      }
    }

    const syncPayload: SyncMessagePayload = {
      type: 'media-sync',
      action: action,
      eventId,
      revision: nextRevision,
      senderId: myParticipantId,
      mediaState: {
        ...stateUpdate,
        videoId: effectiveVideoId,
        videoUrl: effectiveVideoUrl,
        mode: updatedState.mode,
        revision: nextRevision,
        eventId,
        lastUpdatedBy: myParticipantId,
      },
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    if (webrtcRef.current) {
      webrtcRef.current.sendDataMessage(syncPayload);
    }
    if (signalingRef.current) {
      signalingRef.current.sendBroadcast('media-sync', syncPayload);
    }
  }, [myParticipantId, setMediaState, setSession]);

  // Direct playback control helpers
  const playMedia = useCallback(() => {
    updateMediaState({ action: 'play', isPlaying: true, currentTime: mediaStateRef.current.currentTime });
  }, [updateMediaState]);

  const pauseMedia = useCallback(() => {
    updateMediaState({ action: 'pause', isPlaying: false, currentTime: mediaStateRef.current.currentTime });
  }, [updateMediaState]);

  const seekMedia = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(mediaStateRef.current.duration || 10000, time));
    updateMediaState({ action: 'seek', currentTime: clamped, isPlaying: mediaStateRef.current.isPlaying });
  }, [updateMediaState]);

  const changeVideo = useCallback((videoId: string) => {
    const trimmed = videoId.trim();
    if (!trimmed) return;
    updateMediaState({ action: 'video_change', videoId: trimmed, currentTime: 0, isPlaying: true });
  }, [updateMediaState]);

  // Send ephemeral chat message (DataChannel primary with Realtime broadcast fallback)
  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !sessionRef.current) return;

    const msg: ChatMessage = {
      id: generateId(),
      senderId: myParticipantId,
      senderName: myDisplayName,
      role: sessionRef.current.role,
      text: text.trim(),
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev.slice(-99), msg]);

    const syncPayload: SyncMessagePayload = {
      type: 'chat-message',
      chatMessage: msg,
      timestamp: Date.now(),
    };

    const sent = webrtcRef.current?.sendDataMessage(syncPayload);
    if (!sent && signalingRef.current) {
      signalingRef.current.sendBroadcast('chat-message', msg);
    }
  }, [myParticipantId, myDisplayName]);

  // Send floating emoji reaction
  const sendReaction = useCallback((emoji: string) => {
    if (!sessionRef.current) return;

    const newReaction: FloatingReaction = {
      id: generateId(),
      emoji,
      senderName: myDisplayName,
      xOffset: 20 + Math.random() * 60,
      createdAt: Date.now(),
    };

    setReactions(prev => [...prev.slice(-15), newReaction]);

    const payload: SyncMessagePayload = {
      type: 'emoji-reaction',
      reaction: { emoji, senderName: myDisplayName },
      timestamp: Date.now(),
    };

    const sent = webrtcRef.current?.sendDataMessage(payload);
    if (!sent && signalingRef.current) {
      signalingRef.current.sendBroadcast('emoji-reaction', { emoji, senderName: myDisplayName });
    }
  }, [myDisplayName]);

  // Set Local Media Stream (Mode B & C: Local Video File / Screen Share)
  const setLocalMediaStream = useCallback((stream: MediaStream | null) => {
    localMediaStreamRef.current = stream;
    setLocalMediaStreamState(stream);
    if (webrtcRef.current) {
      webrtcRef.current.setMediaStream(stream);
    }
  }, []);

  const setCinemaLights = useCallback((dim: boolean | ((prev: boolean) => boolean)) => {
    setCinemaLightsState(prev => typeof dim === 'function' ? dim(prev) : dim);
  }, []);

  const toggleCinemaLights = useCallback(() => {
    setCinemaLightsState(prev => !prev);
  }, []);

  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);
  const openShareModal = () => setIsShareModalOpen(true);
  const closeShareModal = () => setIsShareModalOpen(false);

  // Auto clean stale floating reactions after 3 seconds
  useEffect(() => {
    if (reactions.length === 0) return;
    const interval = setInterval(() => {
      const cutoff = Date.now() - 3000;
      setReactions(prev => prev.filter(r => r.createdAt > cutoff));
    }, 1000);
    return () => clearInterval(interval);
  }, [reactions.length]);

  return (
    <CinemaContext.Provider
      value={{
        session,
        myParticipantId,
        myDisplayName,
        participants,
        connectionStatus,
        rttMs,
        chatMessages,
        reactions,
        mediaState,
        remoteMediaStream,
        localMediaStream,
        streamStats,
        cinemaLights,
        isSettingsOpen,
        isShareModalOpen,
        setCinemaLights,
        toggleCinemaLights,
        openSettings,
        closeSettings,
        openShareModal,
        closeShareModal,
        joinSession,
        leaveRoom,
        changeMovieMode,
        updateMediaState,
        playMedia,
        pauseMedia,
        seekMedia,
        changeVideo,
        sendMessage,
        sendReaction,
        setLocalMediaStream,
        playerVolume,
        isPlayerMuted,
        setPlayerVolume,
        togglePlayerMute,
      }}
    >
      {children}
    </CinemaContext.Provider>
  );
};

export const useCinema = () => {
  const ctx = useContext(CinemaContext);
  if (!ctx) {
    throw new Error('useCinema must be used within a CinemaProvider');
  }
  return ctx;
};
