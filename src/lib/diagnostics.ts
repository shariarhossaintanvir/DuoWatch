import type { ConnectionStatus } from '../types/cinema';

export type DiagnosticStatus =
  | 'NO_VIDEO_TRACK'
  | 'ICE_FAILED'
  | 'NO_OUTBOUND_FRAMES'
  | 'NO_INBOUND_RTP'
  | 'FRAMES_NOT_DECODING'
  | 'AUTOPLAY_BLOCKED'
  | 'PLAYBACK_WORKING';

export interface DecisionTreeResult {
  status: DiagnosticStatus;
  label: string;
  message: string;
  color: string;
  badgeBg: string;
}

export function computeDiagnosticStatus(params: {
  isOwner: boolean;
  connectionStatus: ConnectionStatus;
  hasLocalVideoTrack: boolean;
  hasRemoteVideoTrack: boolean;
  outboundBytes: number;
  outboundFrames: number;
  inboundBytes: number;
  inboundFramesDecoded: number;
  hasPresentedFrames: boolean;
  isAutoplayBlocked: boolean;
  isVideoPlaying: boolean;
  isAttemptingPlay?: boolean;
}): DecisionTreeResult {
  const {
    isOwner,
    connectionStatus,
    hasLocalVideoTrack,
    hasRemoteVideoTrack,
    outboundBytes,
    outboundFrames,
    inboundBytes,
    inboundFramesDecoded,
    hasPresentedFrames,
    isAutoplayBlocked,
    isVideoPlaying,
    isAttemptingPlay,
  } = params;

  if (connectionStatus === 'failed') {
    return {
      status: 'ICE_FAILED',
      label: 'ICE Failed',
      message: 'Direct P2P connection failed. Firewall or symmetric NAT blocking STUN.',
      color: 'text-red-400',
      badgeBg: 'bg-red-500/20 text-red-300 border-red-500/40',
    };
  }

  if (isOwner) {
    if (!hasLocalVideoTrack) {
      return {
        status: 'NO_VIDEO_TRACK',
        label: 'No Video Track',
        message: 'No movie file selected or track capture is inactive.',
        color: 'text-amber-400',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    }
    if (connectionStatus === 'connected' && outboundBytes === 0 && outboundFrames === 0) {
      return {
        status: 'NO_OUTBOUND_FRAMES',
        label: 'No Outbound RTP',
        message: 'Video is loaded but 0 RTP frames sent to partner (Video paused or awaiting play).',
        color: 'text-amber-400',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    }
    return {
      status: 'PLAYBACK_WORKING',
      label: 'Streaming Active',
      message: 'Host outbound video & audio stream transmitting normally.',
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    };
  } else {
    // Partner (Guest)
    if (!hasRemoteVideoTrack) {
      return {
        status: 'NO_VIDEO_TRACK',
        label: 'Awaiting Host Track',
        message: 'Waiting for incoming movie stream track from host.',
        color: 'text-amber-400',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    }
    if (connectionStatus === 'connected' && inboundBytes === 0 && !isAttemptingPlay) {
      return {
        status: 'NO_INBOUND_RTP',
        label: 'No Inbound RTP',
        message: 'P2P connected but 0 bytes received. Host may be paused or track paused.',
        color: 'text-red-400',
        badgeBg: 'bg-red-500/20 text-red-300 border-red-500/40',
      };
    }
    if (isAutoplayBlocked) {
      return {
        status: 'AUTOPLAY_BLOCKED',
        label: 'Autoplay Blocked',
        message: 'Browser autoplay policy blocked audio/video. User tap required.',
        color: 'text-amber-400',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    }
    if (inboundBytes > 0 && inboundFramesDecoded === 0 && !hasPresentedFrames && isVideoPlaying) {
      return {
        status: 'FRAMES_NOT_DECODING',
        label: 'Decoder Stalled',
        message: 'Receiving RTP packets but video decoder has not decoded any frames.',
        color: 'text-red-400',
        badgeBg: 'bg-red-500/20 text-red-300 border-red-500/40',
      };
    }
    if (hasPresentedFrames || (inboundFramesDecoded > 0 && isVideoPlaying)) {
      return {
        status: 'PLAYBACK_WORKING',
        label: 'Playback Working',
        message: 'Video frames actively decoded and presenting to screen.',
        color: 'text-emerald-400',
        badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      };
    }
    return {
      status: 'PLAYBACK_WORKING',
      label: 'Stream Connected',
      message: 'P2P media pipeline connected.',
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    };
  }
}
