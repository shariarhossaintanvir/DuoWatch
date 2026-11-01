import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { 
  RoomSession, 
  Participant, 
  ConnectionStatus, 
  ChatMessage, 
  FloatingReaction, 
  MediaState, 
  MovieMode, 
  SyncMessagePayload 
} from '../types/cinema';
import { createSignalingService } from '../lib/signaling';
import type { ISignalingService, PeerInfo } from '../lib/signaling';
import { WebRTCManager } from '../lib/webrtc';
import { VoiceManager } from '../lib/audio';
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
  remoteVoiceStream: MediaStream | null;
  localMediaStream: MediaStream | null;
  isMicActive: boolean;
  isMuted: boolean;
  audioLevel: number;
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
  updateMediaState: (update: Partial<MediaState>) => void;
  sendMessage: (text: string) => void;
  sendReaction: (emoji: string) => void;
  toggleMicrophone: () => Promise<void>;
  toggleMute: () => void;
  setLocalMediaStream: (stream: MediaStream | null) => void;
}

const CinemaContext = createContext<CinemaContextValue | null>(null);

export const CinemaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [myParticipantId] = useState<string>(() => generateId());
  const [myDisplayName, setMyDisplayName] = useState<string>('Guest');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [rttMs, setRttMs] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [cinemaLights, setCinemaLights] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);

  // Audio State
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Streams
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const [remoteVoiceStream, setRemoteVoiceStream] = useState<MediaStream | null>(null);
  const [localMediaStream, setLocalMediaStreamState] = useState<MediaStream | null>(null);

  // Default Media State
  const [mediaState, setMediaState] = useState<MediaState>({
    mode: 'youtube',
    videoId: 'dQw4w9WgXcQ',
    currentTime: 0,
    duration: 213,
    isPlaying: false,
    playbackRate: 1,
    lastUpdatedBy: 'owner',
    clientTimestamp: Date.now(),
  });

  const signalingRef = useRef<ISignalingService | null>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const voiceRef = useRef<VoiceManager | null>(null);
  const remoteVoiceAudioEl = useRef<HTMLAudioElement | null>(null);

  // Initialize hidden audio element for remote voice playback
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    remoteVoiceAudioEl.current = audio;
    return () => {
      audio.pause();
      audio.srcObject = null;
    };
  }, []);

  // Update remote voice audio element source
  useEffect(() => {
    if (remoteVoiceAudioEl.current && remoteVoiceStream) {
      remoteVoiceAudioEl.current.srcObject = remoteVoiceStream;
      remoteVoiceAudioEl.current.play().catch(e => console.warn('Autoplay prevented:', e));
    }
  }, [remoteVoiceStream]);

  // Handle incoming DataChannel or Fallback Sync Messages
  const handleDataMessage = useCallback((payload: SyncMessagePayload) => {
    switch (payload.type) {
      case 'media-sync':
        if (payload.mediaState) {
          setMediaState(prev => ({
            ...prev,
            ...payload.mediaState,
            clientTimestamp: payload.clientTimestamp || Date.now(),
          }));
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

      case 'participant-state':
        if (payload.participantState) {
          setParticipants(prev =>
            prev.map(p =>
              p.id !== myParticipantId
                ? {
                    ...p,
                    isMuted: payload.participantState!.isMuted,
                    isSpeaking: payload.participantState!.isSpeaking,
                  }
                : p
            )
          );
        }
        break;
    }
  }, [myParticipantId]);

  // Setup Voice Manager
  useEffect(() => {
    const vm = new VoiceManager({
      onSpeakingChange: (isSpeaking) => {
        setParticipants(prev =>
          prev.map(p => p.id === myParticipantId ? { ...p, isSpeaking } : p)
        );
        // Broadcast voice activity state
        if (webrtcRef.current) {
          webrtcRef.current.sendDataMessage({
            type: 'participant-state',
            participantState: { isMuted, isSpeaking },
            timestamp: Date.now(),
          });
        }
      },
      onAudioLevel: (level) => {
        setAudioLevel(level);
      },
      onError: (err) => {
        console.error('Microphone error:', err);
        setIsMicActive(false);
      },
    });

    voiceRef.current = vm;
    return () => {
      vm.stopMicrophone();
    };
  }, [myParticipantId, isMuted]);

  // Join cinema room session
  const joinSession = useCallback(async (newSession: RoomSession, displayName: string): Promise<boolean> => {
    setSession(newSession);
    setMyDisplayName(displayName);
    setMediaState(newSession.mediaState);

    // Initial participant list with self
    const me: Participant = {
      id: myParticipantId,
      displayName,
      role: newSession.role,
      isOnline: true,
      isMuted: false,
      isSpeaking: false,
    };
    setParticipants([me]);

    // Cleanup existing connections if any
    if (signalingRef.current) {
      signalingRef.current.disconnect();
    }
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
    }

    // 1. Initialize Signaling
    const signaling = createSignalingService();
    signalingRef.current = signaling;

    // 2. Initialize WebRTC Manager
    const webrtc = new WebRTCManager({
      onConnectionStateChange: (status) => {
        setConnectionStatus(status);
        if (status === 'connected') {
          addSystemMessage('Peer connected securely via encrypted WebRTC.');
        } else if (status === 'reconnecting') {
          addSystemMessage('Connection interrupted, attempting automatic reconnection...');
        } else if (status === 'failed') {
          addSystemMessage('Direct P2P connection could not be established. Check firewall/NAT.');
        }
      },
      onDataChannelOpen: () => {
        // If owner, push current media state immediately to guest
        if (newSession.role === 'owner') {
          webrtc.sendDataMessage({
            type: 'media-sync',
            mediaState: newSession.mediaState,
            timestamp: Date.now(),
            clientTimestamp: Date.now(),
          });
        }
      },
      onDataChannelClose: () => {},
      onDataMessage: handleDataMessage,
      onRemoteMediaStream: (stream) => {
        setRemoteMediaStream(stream);
      },
      onRemoteVoiceStream: (stream) => {
        setRemoteVoiceStream(stream);
      },
      onSendSignal: (signal) => {
        signaling.sendSignal(signal);
      },
      onRttUpdate: (rtt) => {
        setRttMs(rtt);
      },
    });

    webrtcRef.current = webrtc;

    // Hook up signaling listeners
    signaling.onSignal((signal) => {
      webrtc.handleSignal(signal);
    });

    signaling.onBroadcast('media-sync', (payload) => {
      handleDataMessage({ type: 'media-sync', ...payload });
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
            isMuted: false,
            isSpeaking: false,
          },
        ];
      });

      addSystemMessage(`${peer.displayName} (${peer.role === 'owner' ? 'Host' : 'Partner'}) joined the cinema.`);

      // Owner initiates the WebRTC offer when Partner connects
      if (newSession.role === 'owner') {
        webrtc.initialize(myParticipantId, peer.id, true);
        webrtc.startAsInitiator();
      } else {
        webrtc.initialize(myParticipantId, peer.id, false);
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
  }, [myParticipantId, handleDataMessage]);

  const addSystemMessage = (text: string) => {
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
  };

  // Leave room and cleanup
  const leaveRoom = useCallback(() => {
    if (session) {
      RoomService.clearSession(session.roomCode);
    }
    if (voiceRef.current) {
      voiceRef.current.stopMicrophone();
      setIsMicActive(false);
    }
    if (localMediaStream) {
      localMediaStream.getTracks().forEach(t => t.stop());
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
    setSession(null);
    setParticipants([]);
    setConnectionStatus('idle');
    setChatMessages([]);
    setReactions([]);
  }, [session, localMediaStream]);

  // Mode change (Owner authoritative)
  const changeMovieMode = useCallback((mode: MovieMode) => {
    if (!session || session.role !== 'owner') return;

    const newMediaState: MediaState = {
      ...mediaState,
      mode,
      currentTime: 0,
      isPlaying: false,
      lastUpdatedBy: myParticipantId,
      clientTimestamp: Date.now(),
    };

    setMediaState(newMediaState);

    // Send over WebRTC DataChannel and signaling fallback
    if (webrtcRef.current) {
      webrtcRef.current.sendDataMessage({
        type: 'media-sync',
        mediaState: newMediaState,
        timestamp: Date.now(),
        clientTimestamp: Date.now(),
      });
    }
    if (signalingRef.current) {
      signalingRef.current.sendBroadcast('media-sync', {
        mediaState: newMediaState,
        clientTimestamp: Date.now(),
      });
    }

    addSystemMessage(`Cinema mode switched to ${mode.toUpperCase()} by Host.`);
  }, [session, mediaState, myParticipantId]);

  // Update Media State (Owner authoritative play/pause/seek)
  const updateMediaState = useCallback((update: Partial<MediaState>) => {
    if (!session || session.role !== 'owner') return;

    const updatedState: MediaState = {
      ...mediaState,
      ...update,
      lastUpdatedBy: myParticipantId,
      clientTimestamp: Date.now(),
    };

    setMediaState(updatedState);

    const syncPayload: SyncMessagePayload = {
      type: 'media-sync',
      mediaState: update,
      timestamp: Date.now(),
      clientTimestamp: Date.now(),
    };

    if (webrtcRef.current) {
      webrtcRef.current.sendDataMessage(syncPayload);
    }
    if (signalingRef.current) {
      signalingRef.current.sendBroadcast('media-sync', syncPayload);
    }
  }, [session, mediaState, myParticipantId]);

  // Send ephemeral chat message
  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !session) return;

    const msg: ChatMessage = {
      id: generateId(),
      senderId: myParticipantId,
      senderName: myDisplayName,
      role: session.role,
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
  }, [session, myParticipantId, myDisplayName]);

  // Send floating emoji reaction
  const sendReaction = useCallback((emoji: string) => {
    if (!session) return;

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
  }, [session, myDisplayName]);

  // Toggle Microphone
  const toggleMicrophone = useCallback(async () => {
    if (!voiceRef.current) return;

    if (isMicActive) {
      voiceRef.current.stopMicrophone();
      if (webrtcRef.current) {
        webrtcRef.current.setVoiceTrack(null);
      }
      setIsMicActive(false);
      setAudioLevel(0);
      setParticipants(prev =>
        prev.map(p => p.id === myParticipantId ? { ...p, isSpeaking: false } : p)
      );
    } else {
      const track = await voiceRef.current.startMicrophone();
      if (track) {
        setIsMicActive(true);
        if (webrtcRef.current) {
          webrtcRef.current.setVoiceTrack(track);
        }
      }
    }
  }, [isMicActive, myParticipantId]);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    if (!voiceRef.current) return;
    const nextMuted = !isMuted;
    voiceRef.current.setMuted(nextMuted);
    setIsMuted(nextMuted);

    setParticipants(prev =>
      prev.map(p => p.id === myParticipantId ? { ...p, isMuted: nextMuted } : p)
    );

    if (webrtcRef.current) {
      webrtcRef.current.sendDataMessage({
        type: 'participant-state',
        participantState: { isMuted: nextMuted, isSpeaking: false },
        timestamp: Date.now(),
      });
    }
  }, [isMuted, myParticipantId]);

  // Set Local Media Stream (Mode B & C)
  const setLocalMediaStream = useCallback((stream: MediaStream | null) => {
    setLocalMediaStreamState(stream);
    if (webrtcRef.current) {
      webrtcRef.current.setMediaStream(stream);
    }
  }, []);

  const toggleCinemaLights = () => setCinemaLights(prev => !prev);
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
        remoteVoiceStream,
        localMediaStream,
        isMicActive,
        isMuted,
        audioLevel,
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
        sendMessage,
        sendReaction,
        toggleMicrophone,
        toggleMute,
        setLocalMediaStream,
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
