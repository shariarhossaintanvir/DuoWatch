import type { WebRTCSignalPayload, ConnectionStatus, SyncMessagePayload, WebRTCStreamStats } from '../types/cinema';

export interface WebRTCConfig {
  stunServers?: string[];
  onConnectionStateChange: (status: ConnectionStatus) => void;
  onDataChannelOpen: () => void;
  onDataChannelClose: () => void;
  onDataMessage: (data: SyncMessagePayload) => void;
  onRemoteMediaStream: (stream: MediaStream) => void;
  onTrackStateChange?: (track: MediaStreamTrack, event: 'unmute' | 'mute' | 'ended') => void;
  onSendSignal: (signal: WebRTCSignalPayload) => void;
  onRttUpdate?: (rttMs: number) => void;
  onStreamStats?: (stats: WebRTCStreamStats) => void;
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
  private iceRestartAttempts: number = 0;
  private readonly maxIceRestarts: number = 2;

  // Track senders: Exactly 2 clean transceivers (Cinema Video & Cinema Media Audio)
  private localVideoSender: RTCRtpSender | null = null;
  private localAudioSender: RTCRtpSender | null = null;
  private currentLocalStream: MediaStream | null = null;
  private boundLocalTrackListeners: { stream: MediaStream; onAdd: any; onRemove: any } | null = null;

  // Remote media stream (Cinema video / screen share + optional system audio)
  private remoteMediaStream: MediaStream = new MediaStream();

  // 1080p High-Quality Configuration & Adaptive Bitrate Controller
  private currentBitrateBps: number = 5_000_000; // Target 5.0 Mbps for unconstrained 1080p30
  private statsInterval: number | null = null;
  private prevOutboundBytes: number = 0;
  private prevOutboundTimestamp: number = 0;
  private prevInboundBytes: number = 0;
  private prevInboundTimestamp: number = 0;
  private consecutiveGoodIntervals: number = 0;
  private negotiatedCodec: string = '';

  constructor(config: WebRTCConfig) {
    this.config = config;
  }

  public initialize(
    localId: string,
    remoteId: string,
    isInitiator: boolean
  ): void {
    // If an active or in-flight connection to this exact remote peer already exists, DO NOT destroy it!
    if (this.pc && this.remoteParticipantId === remoteId) {
      const connState = this.pc.connectionState;
      const sigState = this.pc.signalingState;
      if (
        connState !== 'closed' &&
        connState !== 'failed' &&
        sigState !== 'closed'
      ) {
        return;
      }
    }

    const pendingCandidates = [...this.iceCandidateQueue];
    this.cleanup();
    this.iceCandidateQueue = pendingCandidates;
    this.localParticipantId = localId;
    this.remoteParticipantId = remoteId;
    this.iceRestartAttempts = 0;
    this.currentBitrateBps = 5_000_000;

    const envStuns = import.meta.env.VITE_STUN_SERVERS;
    const stunUrls = (this.config.stunServers || (envStuns ? envStuns.split(',') : [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302',
      'stun:global.stun.twilio.com:3478'
    ])).map((u: string) => ({ urls: u.trim() }));

    const rtcConfiguration: RTCConfiguration = {
      iceServers: stunUrls,
      iceCandidatePoolSize: 2,
    };

    this.pc = new RTCPeerConnection(rtcConfiguration);

    // Pre-allocate exactly TWO transceivers:
    // 1. Cinema video transceiver (local video file or screen share)
    // 2. Cinema media audio transceiver (movie audio or shared tab/system audio)
    try {
      const videoTransceiver = this.pc.addTransceiver('video', { direction: 'sendrecv' });
      this.localVideoSender = videoTransceiver.sender;

      // Prioritize modern high-efficiency video codecs (H.264 & VP9) while keeping all supported codecs
      if (typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function') {
        const capabilities = RTCRtpReceiver.getCapabilities('video');
        if (capabilities && capabilities.codecs && typeof videoTransceiver.setCodecPreferences === 'function') {
          const preferredCodecs = [...capabilities.codecs].sort((a, b) => {
            const score = (mime: string) => {
              const lower = mime.toLowerCase();
              if (lower.includes('h264')) return 3;
              if (lower.includes('vp9')) return 2;
              if (lower.includes('vp8')) return 1;
              return 0;
            };
            return score(b.mimeType) - score(a.mimeType);
          });
          try {
            videoTransceiver.setCodecPreferences(preferredCodecs);
          } catch (e) {
            console.warn('Could not set codec preferences:', e);
          }
        }
      }

      const mediaAudioTransceiver = this.pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.localAudioSender = mediaAudioTransceiver.sender;
    } catch (e) {
      console.warn('Could not add pre-allocated media transceivers:', e);
    }

    // Connection state transitions
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.connectionState;
      console.log(`[DuoWatch WebRTC Diagnostics] PeerConnection state: ${state}`);
      switch (state) {
        case 'connected':
          this.iceRestartAttempts = 0;
          this.config.onConnectionStateChange('connected');
          this.startRttPing();
          this.startStatsMonitoring();
          this.applyHighQualityVideoParameters(this.currentBitrateBps);
          break;
        case 'connecting':
          this.config.onConnectionStateChange('connecting');
          break;
        case 'disconnected':
          this.config.onConnectionStateChange('reconnecting');
          break;
        case 'failed':
          this.config.onConnectionStateChange('failed');
          this.stopStatsMonitoring();
          break;
        case 'closed':
          this.config.onConnectionStateChange('disconnected');
          this.stopRttPing();
          this.stopStatsMonitoring();
          break;
      }
    };

    // ICE connection state transitions with bounded restart backoff
    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      console.log(`[DuoWatch WebRTC Diagnostics] ICE connection state: ${state}`);
      if (state === 'failed') {
        if (this.iceRestartAttempts < this.maxIceRestarts) {
          this.iceRestartAttempts++;
          console.warn(`ICE failed, attempting restart (${this.iceRestartAttempts}/${this.maxIceRestarts})...`);
          try {
            this.pc.restartIce();
          } catch (e) {
            console.error('restartIce error:', e);
          }
        } else {
          console.warn('ICE connection failed after maximum restart attempts.');
          this.config.onConnectionStateChange('failed');
        }
      } else if (state === 'connected') {
        this.iceRestartAttempts = 0;
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

    // Handling remote tracks: maintain a stable remoteMediaStream instance to avoid interrupting HTMLMediaElement playback
    this.pc.ontrack = (event) => {
      const track = event.track;
      console.log(`[DuoWatch WebRTC Diagnostics] ontrack: kind=${track.kind}, id=${track.id}, muted=${track.muted}, readyState=${track.readyState}`);

      if (track.kind === 'video') {
        const existingVideos = this.remoteMediaStream.getVideoTracks();
        const hasTrack = existingVideos.some(t => t.id === track.id);
        if (!hasTrack) {
          existingVideos.forEach(t => {
            try { this.remoteMediaStream.removeTrack(t); } catch { }
          });
          this.remoteMediaStream.addTrack(track);
        }
        this.config.onRemoteMediaStream(this.remoteMediaStream);

        track.onunmute = () => {
          console.log(`[DuoWatch WebRTC Diagnostics] Remote video track unmuted (media packets flowing): id=${track.id}`);
          this.config.onRemoteMediaStream(this.remoteMediaStream);
          this.config.onTrackStateChange?.(track, 'unmute');
        };

        track.onmute = () => {
          console.log(`[DuoWatch WebRTC Diagnostics] Remote video track muted (media paused/buffering): id=${track.id}`);
          this.config.onRemoteMediaStream(this.remoteMediaStream);
          this.config.onTrackStateChange?.(track, 'mute');
        };

        track.onended = () => {
          console.log(`[DuoWatch WebRTC Diagnostics] Remote video track ended: id=${track.id}`);
          try { this.remoteMediaStream.removeTrack(track); } catch { }
          this.config.onRemoteMediaStream(this.remoteMediaStream);
          this.config.onTrackStateChange?.(track, 'ended');
        };
      } else if (track.kind === 'audio') {
        const existingAudios = this.remoteMediaStream.getAudioTracks();
        const hasTrack = existingAudios.some(t => t.id === track.id);
        if (!hasTrack) {
          existingAudios.forEach(t => {
            try { this.remoteMediaStream.removeTrack(t); } catch { }
          });
          this.remoteMediaStream.addTrack(track);
        }
        this.config.onRemoteMediaStream(this.remoteMediaStream);

        track.onunmute = () => {
          console.log(`[DuoWatch WebRTC Diagnostics] Remote audio track unmuted (audio flowing): id=${track.id}`);
          this.config.onRemoteMediaStream(this.remoteMediaStream);
          this.config.onTrackStateChange?.(track, 'unmute');
        };

        track.onmute = () => {
          console.log(`[DuoWatch WebRTC Diagnostics] Remote audio track muted: id=${track.id}`);
          this.config.onRemoteMediaStream(this.remoteMediaStream);
          this.config.onTrackStateChange?.(track, 'mute');
        };

        track.onended = () => {
          console.log(`[DuoWatch WebRTC Diagnostics] Remote audio track ended: id=${track.id}`);
          try { this.remoteMediaStream.removeTrack(track); } catch { }
          this.config.onRemoteMediaStream(this.remoteMediaStream);
          this.config.onTrackStateChange?.(track, 'ended');
        };
      }
    };

    // Renegotiation handling
    this.pc.onnegotiationneeded = async () => {
      if (this.isNegotiating || !this.pc) return;
      try {
        if (this.pc.signalingState !== 'stable') return;
        this.isNegotiating = true;
        const offer = await this.pc.createOffer();
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
      const offer = await this.pc.createOffer();
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

  public setLocalParticipantId(localId: string): void {
    this.localParticipantId = localId;
  }

  public async handleSignal(signal: WebRTCSignalPayload): Promise<void> {
    if (!this.pc) {
      if (signal.type === 'offer' && signal.senderId) {
        this.initialize(this.localParticipantId, signal.senderId, false);
      } else if (signal.type === 'candidate' && signal.candidate) {
        this.iceCandidateQueue.push(signal.candidate);
        return;
      } else {
        return;
      }
    }

    const pc = this.pc;
    if (!pc) return;

    try {
      if (signal.type === 'offer' && signal.sdp) {
        if (pc.signalingState !== 'stable') {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' } as any),
            pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }

        await this.processQueuedIceCandidates();

        const transceivers = pc.getTransceivers();
        if (!this.localVideoSender) {
          const videoTransceiver = transceivers.find(t =>
            (t.sender.track && t.sender.track.kind === 'video') ||
            (t.receiver.track && t.receiver.track.kind === 'video')
          );
          if (videoTransceiver) this.localVideoSender = videoTransceiver.sender;
        }
        if (!this.localAudioSender) {
          const audioTransceiver = transceivers.find(t =>
            (t.sender.track && t.sender.track.kind === 'audio') ||
            (t.receiver.track && t.receiver.track.kind === 'audio')
          );
          if (audioTransceiver) this.localAudioSender = audioTransceiver.sender;
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.applyHighQualityVideoParameters(this.currentBitrateBps);

        this.config.onSendSignal({
          type: 'answer',
          sdp: answer,
          senderId: this.localParticipantId,
          targetId: this.remoteParticipantId,
        });
      } else if (signal.type === 'answer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        await this.processQueuedIceCandidates();
        this.applyHighQualityVideoParameters(this.currentBitrateBps);
      } else if (signal.type === 'candidate' && signal.candidate) {
        const iceCandidate = new RTCIceCandidate(signal.candidate);
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(iceCandidate);
        } else {
          this.iceCandidateQueue.push(signal.candidate);
        }
      } else if (signal.type === 'renegotiate-request') {
        if (pc.signalingState === 'stable') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
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

  // --- 1080p High-Quality Video Sender Configuration ---
  public async applyHighQualityVideoParameters(targetBitrateBps: number = 5_000_000): Promise<void> {
    if (!this.localVideoSender || typeof this.localVideoSender.getParameters !== 'function') return;
    try {
      this.currentBitrateBps = targetBitrateBps;
      const params = this.localVideoSender.getParameters();
      if (!params) return;

      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.encodings[0].maxBitrate = targetBitrateBps;
      params.encodings[0].maxFramerate = 30;
      params.encodings[0].scaleResolutionDownBy = 1.0; // Strictly prevent downscaling 1080p

      // maintain-resolution prevents WebRTC from degrading spatial resolution to 540p or 360p
      if ('degradationPreference' in params || (params as any).degradationPreference === undefined) {
        (params as any).degradationPreference = 'maintain-resolution';
      }

      await this.localVideoSender.setParameters(params);
    } catch (err) {
      console.warn('Non-fatal: could not apply high quality video parameters:', err);
    }
  }

  // --- Cinema Media Stream Management (Local File or Screen Share) ---
  public setMediaStream(stream: MediaStream | null): void {
    if (!this.pc) return;

    // Clean up listeners from previously registered local stream
    if (this.boundLocalTrackListeners) {
      try {
        this.boundLocalTrackListeners.stream.removeEventListener('addtrack', this.boundLocalTrackListeners.onAdd);
        this.boundLocalTrackListeners.stream.removeEventListener('removetrack', this.boundLocalTrackListeners.onRemove);
      } catch { }
      this.boundLocalTrackListeners = null;
    }
    this.currentLocalStream = stream;

    const videoTrack = stream ? (stream.getVideoTracks()[0] || null) : null;
    const audioTrack = stream ? (stream.getAudioTracks()[0] || null) : null;

    console.log(`[DuoWatch WebRTC Diagnostics] setMediaStream: videoTrack=${videoTrack?.id || 'none'} (${videoTrack?.readyState || 'none'}), audioTrack=${audioTrack?.id || 'none'} (${audioTrack?.readyState || 'none'})`);

    if (videoTrack) {
      // Set content hint if supported
      try {
        if (!videoTrack.contentHint) {
          videoTrack.contentHint = 'motion';
        }
      } catch { }
    }

    // 1. Video Track (replaceTrack(null) cleanly stops transmission without destroying transceiver)
    if (this.localVideoSender) {
      this.localVideoSender.replaceTrack(videoTrack).then(() => {
        if (videoTrack) {
          this.applyHighQualityVideoParameters(this.currentBitrateBps);
        }
      }).catch(err => {
        console.warn('Error replacing video track:', err);
      });
    } else if (videoTrack) {
      try {
        this.localVideoSender = this.pc.addTrack(videoTrack, stream!);
        this.applyHighQualityVideoParameters(this.currentBitrateBps);
      } catch (e) {
        console.warn('Could not add video track:', e);
      }
    }

    // 2. Media Audio Track
    if (this.localAudioSender) {
      this.localAudioSender.replaceTrack(audioTrack).catch(err => {
        console.warn('Error replacing media audio track:', err);
      });
    } else if (audioTrack) {
      try {
        this.localAudioSender = this.pc.addTrack(audioTrack, stream!);
      } catch (e) {
        console.warn('Could not add media audio track:', e);
      }
    }

    // 3. Listen for tracks added dynamically (e.g. audio demuxing completes after metadata)
    if (stream) {
      const onAdd = (ev: MediaStreamTrackEvent) => {
        if (!ev.track) return;
        console.log(`[DuoWatch WebRTC Diagnostics] Dynamic track added to local stream: kind=${ev.track.kind}, id=${ev.track.id}`);
        if (ev.track.kind === 'video' && this.localVideoSender) {
          this.localVideoSender.replaceTrack(ev.track).then(() => {
            this.applyHighQualityVideoParameters(this.currentBitrateBps);
          }).catch(() => { });
        } else if (ev.track.kind === 'audio' && this.localAudioSender) {
          this.localAudioSender.replaceTrack(ev.track).catch(() => { });
        }
      };

      const onRemove = (ev: MediaStreamTrackEvent) => {
        if (!ev.track) return;
        console.log(`[DuoWatch WebRTC Diagnostics] Track removed from local stream: kind=${ev.track.kind}, id=${ev.track.id}`);
        if (ev.track.kind === 'video' && this.localVideoSender) {
          const remainingVideo = stream.getVideoTracks()[0] || null;
          this.localVideoSender.replaceTrack(remainingVideo).catch(() => { });
        } else if (ev.track.kind === 'audio' && this.localAudioSender) {
          const remainingAudio = stream.getAudioTracks()[0] || null;
          this.localAudioSender.replaceTrack(remainingAudio).catch(() => { });
        }
      };

      try {
        stream.addEventListener('addtrack', onAdd);
        stream.addEventListener('removetrack', onRemove);
        this.boundLocalTrackListeners = { stream, onAdd, onRemove };
      } catch { }
    }
  }

  public getLocalStream(): MediaStream | null {
    return this.currentLocalStream;
  }

  // --- Real-Time Stream Telemetry & Adaptive Bitrate Controller ---
  private startStatsMonitoring(): void {
    this.stopStatsMonitoring();
    this.statsInterval = window.setInterval(async () => {
      await this.collectStreamStats();
    }, 2000);
  }

  private stopStatsMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.prevOutboundBytes = 0;
    this.prevOutboundTimestamp = 0;
    this.prevInboundBytes = 0;
    this.prevInboundTimestamp = 0;
  }

  private async collectStreamStats(): Promise<void> {
    if (!this.pc || typeof this.pc.getStats !== 'function') return;
    try {
      const reports = await this.pc.getStats();
      let outboundData: any = null;
      let inboundData: any = null;
      let remoteInboundData: any = null;
      let codecName: string | undefined = this.negotiatedCodec || undefined;

      reports.forEach((report: any) => {
        if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          const now = report.timestamp || Date.now();
          let bitrateBps = 0;
          if (this.prevOutboundTimestamp > 0 && now > this.prevOutboundTimestamp) {
            const deltaBytes = Math.max(0, (report.bytesSent || 0) - this.prevOutboundBytes);
            const deltaSec = (now - this.prevOutboundTimestamp) / 1000;
            bitrateBps = Math.round((deltaBytes * 8) / deltaSec);
          }
          this.prevOutboundBytes = report.bytesSent || 0;
          this.prevOutboundTimestamp = now;

          outboundData = {
            frameWidth: report.frameWidth || 0,
            frameHeight: report.frameHeight || 0,
            fps: Math.round(report.framesPerSecond || 0),
            bitrateBps,
            framesSent: report.framesSent || 0,
            bytesSent: report.bytesSent || 0,
            qualityLimitationReason: report.qualityLimitationReason || 'none',
            targetBitrateBps: this.currentBitrateBps,
          };
        } else if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          const now = report.timestamp || Date.now();
          let bitrateBps = 0;
          if (this.prevInboundTimestamp > 0 && now > this.prevInboundTimestamp) {
            const deltaBytes = Math.max(0, (report.bytesReceived || 0) - this.prevInboundBytes);
            const deltaSec = (now - this.prevInboundTimestamp) / 1000;
            bitrateBps = Math.round((deltaBytes * 8) / deltaSec);
          }
          this.prevInboundBytes = report.bytesReceived || 0;
          this.prevInboundTimestamp = now;

          inboundData = {
            frameWidth: report.frameWidth || 0,
            frameHeight: report.frameHeight || 0,
            fps: Math.round(report.framesPerSecond || 0),
            bitrateBps,
            framesReceived: report.framesReceived || 0,
            framesDecoded: report.framesDecoded || 0,
            framesDropped: report.framesDropped || 0,
            packetsLost: report.packetsLost || 0,
            bytesReceived: report.bytesReceived || 0,
            jitter: Math.round((report.jitter || 0) * 1000),
          };
        } else if (report.type === 'remote-inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          remoteInboundData = {
            fractionLost: report.fractionLost || 0,
            roundTripTime: report.roundTripTime || 0,
          };
        } else if (report.type === 'codec' && report.mimeType) {
          codecName = report.mimeType;
          this.negotiatedCodec = report.mimeType;
        }
      });

      // Adaptive Bitrate Controller: adjusts encoder bandwidth smoothly without renegotiation
      if (outboundData && this.localVideoSender?.track) {
        const fractionLost = remoteInboundData?.fractionLost || 0;
        const rtt = remoteInboundData?.roundTripTime || 0;
        const limitReason = outboundData.qualityLimitationReason;

        if (fractionLost > 0.05 || limitReason === 'bandwidth' || rtt > 0.25) {
          // Network congestion detected: gracefully step down by 500 kbps (floor at 1.5 Mbps)
          this.consecutiveGoodIntervals = 0;
          if (this.currentBitrateBps > 1_500_000) {
            const nextBitrate = Math.max(1_500_000, this.currentBitrateBps - 500_000);
            this.applyHighQualityVideoParameters(nextBitrate);
          }
        } else if (fractionLost === 0 && (rtt < 0.1 || rtt === 0) && limitReason === 'none') {
          // Clean network: after 3 consecutive clean checks (6 seconds), ramp up towards 5.5 Mbps
          this.consecutiveGoodIntervals++;
          if (this.consecutiveGoodIntervals >= 3 && this.currentBitrateBps < 5_500_000) {
            const nextBitrate = Math.min(5_500_000, this.currentBitrateBps + 500_000);
            this.applyHighQualityVideoParameters(nextBitrate);
            this.consecutiveGoodIntervals = 0;
          }
        }
      }

      const streamStats: WebRTCStreamStats = {
        timestamp: Date.now(),
        codec: codecName,
        outbound: outboundData || undefined,
        inbound: inboundData || undefined,
        rttMs: remoteInboundData ? Math.round(remoteInboundData.roundTripTime * 1000) : undefined,
      };

      if (this.config.onStreamStats) {
        this.config.onStreamStats(streamStats);
      }
    } catch (err) {
      console.warn('Error collecting stream stats:', err);
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
    this.stopStatsMonitoring();
    if (this.boundLocalTrackListeners) {
      try {
        this.boundLocalTrackListeners.stream.removeEventListener('addtrack', this.boundLocalTrackListeners.onAdd);
        this.boundLocalTrackListeners.stream.removeEventListener('removetrack', this.boundLocalTrackListeners.onRemove);
      } catch { }
      this.boundLocalTrackListeners = null;
    }
    this.currentLocalStream = null;
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch { }
      this.dataChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch { }
      this.pc = null;
    }
    this.localVideoSender = null;
    this.localAudioSender = null;
    this.remoteMediaStream = new MediaStream();
    this.iceCandidateQueue = [];
    this.isNegotiating = false;
    this.iceRestartAttempts = 0;
  }
}
