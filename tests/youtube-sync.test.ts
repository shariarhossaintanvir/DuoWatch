import { describe, it, expect } from 'vitest';

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/;
  const match = trimmed.match(regExp);
  return match ? match[1] : null;
}

function calculateDrift(
  hostCurrentTime: number,
  hostClientTimestamp: number,
  hostIsPlaying: boolean,
  guestCurrentTime: number,
  now: number = Date.now(),
  threshold: number = 0.75
): { drift: number; targetTime: number; requiresCorrection: boolean } {
  const elapsedSec = (now - hostClientTimestamp) / 1000;
  const targetTime = hostCurrentTime + (hostIsPlaying ? Math.max(0, elapsedSec) : 0);
  const drift = Math.abs(guestCurrentTime - targetTime);
  return {
    drift,
    targetTime,
    requiresCorrection: drift > threshold,
  };
}

describe('YouTube Sync Engine & Drift Correction', () => {
  describe('Video ID Parsing', () => {
    it('should parse standard YouTube watch URLs', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractVideoId('https://www.youtube.com/watch?t=10s&v=dQw4w9WgXcQ&feature=share')).toBe('dQw4w9WgXcQ');
    });

    it('should parse shortened youtu.be URLs', () => {
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractVideoId('http://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    });

    it('should parse embed URLs', () => {
      expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should accept direct 11-character video IDs', () => {
      expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractVideoId('M7lc1UVf-VE')).toBe('M7lc1UVf-VE');
    });

    it('should reject non-YouTube URLs or invalid strings', () => {
      expect(extractVideoId('https://vimeo.com/123456789')).toBeNull();
      expect(extractVideoId('not-a-valid-video-link')).toBeNull();
      expect(extractVideoId('')).toBeNull();
    });
  });

  describe('Clock Offset & Drift Correction Calculation', () => {
    it('should not require seek correction when drift is within 0.75s threshold', () => {
      const now = 1700000000000;
      const hostTime = 45.0;
      const hostTimestamp = now - 200; // 200ms in transit
      const guestTime = 45.1; // 100ms drift

      const res = calculateDrift(hostTime, hostTimestamp, true, guestTime, now, 0.75);

      expect(res.requiresCorrection).toBe(false);
      expect(res.drift).toBeLessThan(0.75);
    });

    it('should require seek correction when drift exceeds threshold', () => {
      const now = 1700000000000;
      const hostTime = 60.0;
      const hostTimestamp = now - 300;
      const guestTime = 55.0; // 5.3s behind!

      const res = calculateDrift(hostTime, hostTimestamp, true, guestTime, now, 0.75);

      expect(res.requiresCorrection).toBe(true);
      expect(res.drift).toBeGreaterThan(0.75);
      expect(res.targetTime).toBeCloseTo(60.3, 1);
    });

    it('should account for paused state without advancing target time', () => {
      const now = 1700000000000;
      const hostTime = 120.0;
      const hostTimestamp = now - 5000; // Paused 5 seconds ago
      const guestTime = 120.0;

      const res = calculateDrift(hostTime, hostTimestamp, false, guestTime, now, 0.75);

      expect(res.requiresCorrection).toBe(false);
      expect(res.targetTime).toBe(120.0);
    });
  });
});
