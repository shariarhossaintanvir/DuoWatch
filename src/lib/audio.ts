export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface VoiceManagerCallbacks {
  onSpeakingChange: (isSpeaking: boolean) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (err: Error) => void;
}

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private animFrameId: number | null = null;
  private callbacks: VoiceManagerCallbacks;
  private isMuted: boolean = false;
  private isSpeaking: boolean = false;
  private silenceTimer: number | null = null;

  constructor(callbacks: VoiceManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public async startMicrophone(deviceId?: string): Promise<MediaStreamTrack | null> {
    this.stopMicrophone();

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId };
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      const track = this.localStream.getAudioTracks()[0];
      if (!track) return null;

      track.enabled = !this.isMuted;
      this.setupAudioAnalysis(this.localStream);

      return track;
    } catch (err: any) {
      console.warn('Microphone permission or hardware access issue:', err);
      if (this.callbacks.onError) {
        this.callbacks.onError(err);
      }
      return null;
    }
  }

  private setupAudioAnalysis(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.4;

      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkAudioLevel = () => {
        if (!this.analyser || this.isMuted) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.callbacks.onSpeakingChange(false);
          }
          if (this.callbacks.onAudioLevel) {
            this.callbacks.onAudioLevel(0);
          }
          this.animFrameId = requestAnimationFrame(checkAudioLevel);
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedLevel = Math.min(1, average / 128);

        if (this.callbacks.onAudioLevel) {
          this.callbacks.onAudioLevel(normalizedLevel);
        }

        // Speaking threshold
        const threshold = 0.08;
        if (normalizedLevel > threshold) {
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            this.callbacks.onSpeakingChange(true);
          }
          if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
          }
        } else if (this.isSpeaking && !this.silenceTimer) {
          // Debounce turning off speaking indicator
          this.silenceTimer = window.setTimeout(() => {
            this.isSpeaking = false;
            this.callbacks.onSpeakingChange(false);
            this.silenceTimer = null;
          }, 350);
        }

        this.animFrameId = requestAnimationFrame(checkAudioLevel);
      };

      this.animFrameId = requestAnimationFrame(checkAudioLevel);
    } catch (e) {
      console.warn('AudioContext analysis not supported or blocked:', e);
    }
  }

  public setMuted(muted: boolean): boolean {
    this.isMuted = muted;
    if (this.localStream) {
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !muted;
      }
    }
    if (muted && this.isSpeaking) {
      this.isSpeaking = false;
      this.callbacks.onSpeakingChange(false);
    }
    return this.isMuted;
  }

  public getTrack(): MediaStreamTrack | null {
    if (this.localStream) {
      return this.localStream.getAudioTracks()[0] || null;
    }
    return null;
  }

  public static async getAvailableMicrophones(): Promise<AudioDeviceOption[]> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${index + 1}`,
        }));
    } catch (e) {
      console.warn('Failed to enumerate audio devices:', e);
      return [];
    }
  }

  public stopMicrophone(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
      this.sourceNode = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (e) {}
      this.analyser = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.isSpeaking = false;
  }
}
