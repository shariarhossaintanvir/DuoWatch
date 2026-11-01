import type { WebRTCSignalPayload, ConnectionStatus, SyncMessagePayload } from '../types/cinema';

export interface WebRTCConfig {
  stunServers?: string[];
  onConnectionStateChange: (status: ConnectionStatus) => void;
  onDataChannelOpen: () => void;
  onDataChannelClose: () => void;
  onDataMessage: (data: SyncMessagePayload) => void;
  onRemoteMediaStream: (stream: MediaStream) => void;
  onRemoteVoiceStream: (stream: MediaStream) => void;
  onSendSignal: (signal: WebRTCSignalPayload) => void;
  onRttUpdate?: (rttMs: number) => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private config: WebRTCConfig;
  private localParticipantId: string = '';
  private remoteParticipantId: string = '';
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private isNegotiating: boolean = false;
  private pingInterval: number | null = null;
  private pendingPingTimestamp: number = 0;

  // Track senders
  private localVoiceSender: RTCRtpSender | null = null;
  private localVideoSender: RTCRtpSender | null = null;
  private localAudioSender: RTCRtpSender | null = null;

  // Remote streams
  private remoteMediaStream: MediaStream = new MediaStream();
  private remoteVoiceStream: MediaStream = new MediaStream();

  constructor(config: WebRTCConfig) {
    this.config = config;
  }

  public initialize(
    localId: string, 
    remoteId: string, 
    isInitiator: boolean
  ): void {
    this.cleanup();
    this.localParticipantId = localId;
    this.remoteParticipantId = remoteId;

    const envStuns = import.meta.env.VITE_STUN_SERVERS;
    const stunUrls = (this.config.stunServers || (envStuns ? envStuns.split(',') : [
      'stun:stun.l.google.com:19302',
      'stun:global.stun.twilio.com:3478'
    ])).map((u: string) => ({ urls: u.trim() }));

    const rtcConfiguration: RTCConfiguration = {
      iceServers: stunUrls,
      iceCandidatePoolSize: 2,
    };

    this.pc = new RTCPeerConnection(rtcConfiguration);

    // Track state changes
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.connectionState;
      switch (state) {
        case 'connected':
          this.config.onConnectionStateChange('connected');
          this.startRttPing();
          break;
        case 'connecting':
          this.config.onConnectionStateChange('connecting');
          break;
        case 'disconnected':
          this.config.onConnectionStateChange('reconnecting');
          break;
        case 'failed':
          this.config.onConnectionStateChange('failed');
          break;
        case 'closed':
          this.config.onConnectionStateChange('disconnected');
          this.stopRttPing();
          break;
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.iceConnectionState === 'failed') {
        this.pc.restartIce();
      }
    };

    // ICE Candidate trickling
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.config.onSendSignal({
          type: 'candidate',
          candidate: event.candidate.toJSON(),
          senderId: this.localParticipantId,
          targetId: this.remoteParticipantId,
        });
      }
    };

    // Handling remote tracks
    this.pc.ontrack = (event) => {
      const track = event.track;
      const streams = event.streams;

      if (track.kind === 'video') {
        // Any incoming video track belongs to cinema movie / screen share
        this.remoteMediaStream.getVideoTracks().forEach(t => this.remoteMediaStream.removeTrack(t));
        this.remoteMediaStream.addTrack(track);
        this.config.onRemoteMediaStream(this.remoteMediaStream);
      } else if (track.kind === 'audio') {
        // If track belongs to a stream with video, it's cinema media audio; otherwise voice
        const isMediaAudio = streams[0] && streams[0].getVideoTracks().length > 0;
        if (isMediaAudio) {
          this.remoteMediaStream.getAudioTracks().forEach(t => this.remoteMediaStream.removeTrack(t));
          this.remoteMediaStream.addTrack(track);
          this.config.onRemoteMediaStream(this.remoteMediaStream);
        } else {
          this.remoteVoiceStream.getAudioTracks().forEach(t => this.remoteVoiceStream.removeTrack(t));
          this.remoteVoiceStream.addTrack(track);
          this.config.onRemoteVoiceStream(this.remoteVoiceStream);
        }
      }
    };

    // Negotiation Needed
    this.pc.onnegotiationneeded = async () => {
      if (this.isNegotiating || !this.pc) return;
      try {
        this.isNegotiating = true;
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== 'stable') return;
        await this.pc.setLocalDescription(offer);
        this.config.onSendSignal({
          type: 'offer',
          sdp: offer,
          senderId: this.localParticipantId,
          targetId: this.remoteParticipantId,
        });
      } catch (err) {
        console.error('Error during renegotiation:', err);
      } finally {
        this.isNegotiating = false;
      }
    };

    // Data Channel Setup
    if (isInitiator) {
      this.dataChannel = this.pc.createDataChannel('duowatch-sync', {
        ordered: true,
      });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.onopen = () => {
      this.config.onDataChannelOpen();
    };

    channel.onclose = () => {
      this.config.onDataChannelClose();
    };

    channel.onmessage = (event) => {
      try {
        const payload: SyncMessagePayload = JSON.parse(event.data);
        if (payload.type === 'ping') {
          this.sendDataMessage({
            type: 'pong',
            timestamp: payload.timestamp,
          });
        } else if (payload.type === 'pong') {
          const rtt = Date.now() - payload.timestamp;
          if (this.config.onRttUpdate) {
            this.config.onRttUpdate(Math.max(1, rtt));
          }
        } else {
          this.config.onDataMessage(payload);
        }
      } catch (err) {
        console.error('Failed to parse WebRTC DataChannel message:', err);
      }
    };
  }

  public async startAsInitiator(): Promise<void> {
    if (!this.pc) return;
    try {
      this.isNegotiating = true;
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.pc.setLocalDescription(offer);
      this.config.onSendSignal({
        type: 'offer',
        sdp: offer,
        senderId: this.localParticipantId,
        targetId: this.remoteParticipantId,
      });
    } catch (err) {
      console.error('Error creating offer:', err);
    } finally {
      this.isNegotiating = false;
    }
  }

  public async handleSignal(signal: WebRTCSignalPayload): Promise<void> {
    if (!this.pc) return;

    try {
      if (signal.type === 'offer' && signal.sdp) {
        if (this.pc.signalingState !== 'stable') {
          // Handle glare if both attempted offer
          await Promise.all([
            this.pc.setLocalDescription({ type: 'rollback' } as any),
            this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)),
          ]);
        } else {
          await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }

        this.processQueuedIceCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.config.onSendSignal({
          type: 'answer',
          sdp: answer,
          senderId: this.localParticipantId,
          targetId: this.remoteParticipantId,
        });
      } else if (signal.type === 'answer' && signal.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        this.processQueuedIceCandidates();
      } else if (signal.type === 'candidate' && signal.candidate) {
        const iceCandidate = new RTCIceCandidate(signal.candidate);
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
          await this.pc.addIceCandidate(iceCandidate);
        } else {
          this.iceCandidateQueue.push(signal.candidate);
        }
      } else if (signal.type === 'renegotiate-request') {
        if (this.pc.signalingState === 'stable') {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.config.onSendSignal({
            type: 'offer',
            sdp: offer,
            senderId: this.localParticipantId,
            targetId: this.remoteParticipantId,
          });
        }
      }
    } catch (err) {
      console.error('Error handling WebRTC signal:', err);
    }
  }

  private async processQueuedIceCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Error adding queued ICE candidate:', err);
        }
      }
    }
  }

  // --- Voice Track Management ---
  public setVoiceTrack(track: MediaStreamTrack | null): void {
    if (!this.pc) return;

    if (track) {
      if (this.localVoiceSender) {
        this.localVoiceSender.replaceTrack(track);
      } else {
        const stream = new MediaStream([track]);
        this.localVoiceSender = this.pc.addTrack(track, stream);
      }
    } else {
      if (this.localVoiceSender) {
        try {
          this.pc.removeTrack(this.localVoiceSender);
        } catch (e) {
          console.warn('Error removing voice track:', e);
        }
        this.localVoiceSender = null;
      }
    }
  }

  // --- Cinema Media Stream Management (Local File or Screen Share) ---
  public setMediaStream(stream: MediaStream | null): void {
    if (!this.pc) return;

    const videoTrack = stream ? stream.getVideoTracks()[0] : null;
    const audioTrack = stream ? stream.getAudioTracks()[0] : null;

    // Video Track
    if (videoTrack) {
      if (this.localVideoSender) {
        this.localVideoSender.replaceTrack(videoTrack);
      } else {
        this.localVideoSender = this.pc.addTrack(videoTrack, stream!);
      }
    } else if (this.localVideoSender) {
      try {
        this.pc.removeTrack(this.localVideoSender);
      } catch (e) {
        console.warn('Error removing video track:', e);
      }
      this.localVideoSender = null;
    }

    // Media Audio Track
    if (audioTrack) {
      if (this.localAudioSender) {
        this.localAudioSender.replaceTrack(audioTrack);
      } else {
        this.localAudioSender = this.pc.addTrack(audioTrack, stream!);
      }
    } else if (this.localAudioSender) {
      try {
        this.pc.removeTrack(this.localAudioSender);
      } catch (e) {
        console.warn('Error removing audio track:', e);
      }
      this.localAudioSender = null;
    }
  }

  public sendDataMessage(message: SyncMessagePayload): boolean {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error('Failed to send data channel message:', err);
      }
    }
    return false;
  }

  private startRttPing() {
    this.stopRttPing();
    this.pingInterval = window.setInterval(() => {
      this.pendingPingTimestamp = Date.now();
      this.sendDataMessage({
        type: 'ping',
        timestamp: this.pendingPingTimestamp,
      });
    }, 3000);
  }

  private stopRttPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public cleanup(): void {
    this.stopRttPing();
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.localVoiceSender = null;
    this.localVideoSender = null;
    this.localAudioSender = null;
    this.remoteMediaStream = new MediaStream();
    this.remoteVoiceStream = new MediaStream();
    this.iceCandidateQueue = [];
    this.isNegotiating = false;
  }
}
