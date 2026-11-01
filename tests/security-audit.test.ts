import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Security & Zero-Cost Architecture Audit', () => {
  it('should not contain exposed Supabase service_role keys or secrets in environment or code files', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const filesToCheck = [
      path.join(projectRoot, '.env'),
      path.join(projectRoot, '.env.example'),
      path.join(projectRoot, 'src', 'lib', 'supabase.ts'),
      path.join(projectRoot, 'src', 'lib', 'roomService.ts'),
    ];

    filesToCheck.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Ensure no active assignment of service_role secret key
        expect(content).not.toMatch(/(?:VITE_)?(?:SUPABASE_)?SERVICE_ROLE(?:_KEY)?\s*=\s*[^\s#]+/i);
        expect(content).not.toMatch(/SUPABASE_SERVICE_KEY\s*=\s*[^\s#]+/i);
        // Ensure no real 3-part base64 JWT secrets leaked
        expect(content).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
      }
    });
  });

  it('should verify that Mode B local file streaming uses WebRTC and never uploads to a server', () => {
    const localPlayerPath = path.resolve(__dirname, '..', 'src', 'components', 'player', 'LocalFilePlayer.tsx');
    expect(fs.existsSync(localPlayerPath)).toBe(true);

    const content = fs.readFileSync(localPlayerPath, 'utf-8');

    // Must use browser Object URL and captureStream
    expect(content).toContain('URL.createObjectURL');
    expect(content).toContain('captureStream');

    // Must not use fetch POST/PUT or FormData for video upload
    expect(content).not.toMatch(/fetch\s*\([^)]*method:\s*['"]POST['"][^)]*FormData/);
    expect(content).not.toContain('axios.post');
  });

  it('should verify that Mode C screen sharing captures browser display media and cleans up tracks', () => {
    const screenPlayerPath = path.resolve(__dirname, '..', 'src', 'components', 'player', 'ScreenSharePlayer.tsx');
    expect(fs.existsSync(screenPlayerPath)).toBe(true);

    const content = fs.readFileSync(screenPlayerPath, 'utf-8');

    expect(content).toContain('navigator.mediaDevices.getDisplayMedia');
    expect(content).toContain('onended');
  });

  it('should verify that public STUN servers are configured with zero paid TURN dependencies', () => {
    const webrtcPath = path.resolve(__dirname, '..', 'src', 'lib', 'webrtc.ts');
    const content = fs.readFileSync(webrtcPath, 'utf-8');

    expect(content).toContain('stun:stun.l.google.com:19302');
    expect(content).toContain('stun:global.stun.twilio.com:3478');
    expect(content).not.toMatch(/turn:[^,\s]+(?:\.metered|\.xirsys|\.twilio\b(?!.*stun))/); // No paid TURN services
  });
});
