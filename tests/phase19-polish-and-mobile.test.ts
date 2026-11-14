import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('DuoWatch Phase 19: Complete Website Polish, Bug Fixes & Mobile Optimization Suite', () => {
  const rootDir = path.resolve(__dirname, '..');

  describe('1. Navigation & Layout Verification', () => {
    it('verifies all expected routes are registered in App.tsx', () => {
      const appFile = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf-8');
      expect(appFile).toContain('path="/"');
      expect(appFile).toContain('path="/create"');
      expect(appFile).toContain('path="/join"');
      expect(appFile).toContain('path="/room/:roomCode"');
      expect(appFile).toContain('path="/privacy"');
      expect(appFile).toContain('path="/terms"');
      expect(appFile).toContain('path="*"');
    });

    it('verifies Navbar includes clickable logo, mobile navigation menu, and proper close actions', () => {
      const navbarFile = fs.readFileSync(path.join(rootDir, 'src/components/Navbar.tsx'), 'utf-8');
      // Logo navigates to home
      expect(navbarFile).toContain('to="/"');
      // Mobile hamburger toggle state
      expect(navbarFile).toContain('isMobileMenuOpen');
      expect(navbarFile).toContain('setIsMobileMenuOpen');
      // Auto-close on route change
      expect(navbarFile).toContain('location.pathname');
      // Escape key listener
      expect(navbarFile).toContain('Escape');
    });

    it('verifies Footer includes valid internal navigation links', () => {
      const footerFile = fs.readFileSync(path.join(rootDir, 'src/components/common/Footer.tsx'), 'utf-8');
      expect(footerFile).toContain('to="/"');
      expect(footerFile).toContain('to="/create"');
      expect(footerFile).toContain('to="/join"');
      expect(footerFile).toContain('to="/privacy"');
      expect(footerFile).toContain('to="/terms"');
    });
  });

  describe('2. Links & Contact Information Integrity', () => {
    it('verifies no fake emails or dummy phone numbers exist in source code', () => {
      const srcFiles = [
        'src/pages/LandingPage.tsx',
        'src/pages/CreateRoomPage.tsx',
        'src/pages/JoinRoomPage.tsx',
        'src/pages/PrivacyPage.tsx',
        'src/pages/TermsPage.tsx',
        'src/pages/NotFoundPage.tsx',
        'src/components/Navbar.tsx',
        'src/components/common/Footer.tsx',
      ];

      for (const relPath of srcFiles) {
        const content = fs.readFileSync(path.join(rootDir, relPath), 'utf-8');
        // No dummy 555 numbers or fake test emails
        expect(content).not.toMatch(/555-\d{3,4}/);
        expect(content).not.toMatch(/example\.com/);
        expect(content).not.toMatch(/foo@bar/);
      }
    });

    it('verifies external compliance links in Terms and Privacy are valid YouTube/Google URLs', () => {
      const termsFile = fs.readFileSync(path.join(rootDir, 'src/pages/TermsPage.tsx'), 'utf-8');
      const privacyFile = fs.readFileSync(path.join(rootDir, 'src/pages/PrivacyPage.tsx'), 'utf-8');

      expect(termsFile).toContain('https://www.youtube.com/t/terms');
      expect(privacyFile).toContain('https://www.youtube.com/t/terms');
      expect(privacyFile).toContain('https://policies.google.com/privacy');
    });
  });

  describe('3. Dynamic Copyright & Date Accuracy', () => {
    it('verifies dynamic current year is used in the Footer instead of hardcoded outdated years', () => {
      const footerFile = fs.readFileSync(path.join(rootDir, 'src/components/common/Footer.tsx'), 'utf-8');
      const currentYear = new Date().getFullYear();
      expect(currentYear).toBeGreaterThanOrEqual(2025);

      expect(footerFile).toContain('new Date().getFullYear()');
      expect(footerFile).toContain('© {CURRENT_YEAR} DuoWatch. All rights reserved.');
      // Should not contain hardcoded outdated year like "2023" or "2024"
      expect(footerFile).not.toContain('© 2023');
      expect(footerFile).not.toContain('© 2024');
      expect(footerFile).not.toContain('© 2025');
    });
  });

  describe('4. SEO, Page Metadata & Favicons', () => {
    it('verifies index.html has valid viewport, theme-color, and favicon references', () => {
      const htmlFile = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

      // Standard mobile responsive viewport without user-scalable=no
      expect(htmlFile).toContain('width=device-width, initial-scale=1.0');
      expect(htmlFile).not.toContain('user-scalable=no');

      // Theme color and favicons
      expect(htmlFile).toContain('meta name="theme-color"');
      expect(htmlFile).toContain('href="/favicon.svg"');
      expect(htmlFile).toContain('href="/favicon.ico"');
    });

    it('verifies favicon files exist on disk in public folder', () => {
      const faviconSvgPath = path.join(rootDir, 'public/favicon.svg');
      const faviconIcoPath = path.join(rootDir, 'public/favicon.ico');

      expect(fs.existsSync(faviconSvgPath)).toBe(true);
      expect(fs.existsSync(faviconIcoPath)).toBe(true);

      const svgStat = fs.statSync(faviconSvgPath);
      const icoStat = fs.statSync(faviconIcoPath);
      expect(svgStat.size).toBeGreaterThan(100);
      expect(icoStat.size).toBeGreaterThan(500);
    });

    it('verifies unique meaningful SEO metadata across all pages without em dashes', () => {
      const pages = [
        { path: 'src/pages/LandingPage.tsx', title: 'DuoWatch: Private Watch Party for Two' },
        { path: 'src/pages/CreateRoomPage.tsx', title: 'Create Private Watch Room: DuoWatch' },
        { path: 'src/pages/JoinRoomPage.tsx', title: 'Join Private Watch Room: DuoWatch' },
        { path: 'src/pages/CinemaRoomPage.tsx', title: 'Cinema Room:' },
        { path: 'src/pages/PrivacyPage.tsx', title: 'Privacy Policy: DuoWatch' },
        { path: 'src/pages/TermsPage.tsx', title: 'Terms and Conditions: DuoWatch' },
        { path: 'src/pages/NotFoundPage.tsx', title: '404: Page Not Found | DuoWatch' },
      ];

      for (const page of pages) {
        const content = fs.readFileSync(path.join(rootDir, page.path), 'utf-8');
        expect(content).toContain(page.title);
        expect(content).toContain('<SEO');
        expect(page.title).not.toContain('—');
      }
    });
  });

  describe('5. Professional 404 Page', () => {
    it('verifies NotFoundPage has explicit Page Not Found message and functional home return button', () => {
      const notFoundFile = fs.readFileSync(path.join(rootDir, 'src/pages/NotFoundPage.tsx'), 'utf-8');
      expect(notFoundFile).toContain('Page Not Found');
      expect(notFoundFile).toContain('Return to Home');
      expect(notFoundFile).toContain('to="/"');
    });
  });

  describe('6. Mobile Responsiveness & Overflow Guards', () => {
    it('verifies root index.css enforces horizontal overflow prevention', () => {
      const indexCss = fs.readFileSync(path.join(rootDir, 'src/index.css'), 'utf-8');
      expect(indexCss).toContain('overflow-x: hidden');
    });

    it('verifies LandingPage wraps root container with overflow-x-clip to prevent ambient glow overflow', () => {
      const landingFile = fs.readFileSync(path.join(rootDir, 'src/pages/LandingPage.tsx'), 'utf-8');
      expect(landingFile).toContain('overflow-x-clip');
    });

    it('verifies CinemaPlayer viewport supports small screens without rigid tall min-height', () => {
      const playerFile = fs.readFileSync(path.join(rootDir, 'src/components/player/CinemaPlayer.tsx'), 'utf-8');
      expect(playerFile).toContain('min-h-[200px]');
    });

    it('verifies ChatSidebar supports responsive mobile drawer overlay on < lg screens', () => {
      const chatFile = fs.readFileSync(path.join(rootDir, 'src/components/chat/ChatSidebar.tsx'), 'utf-8');
      expect(chatFile).toContain('fixed inset-y-0 right-0');
      expect(chatFile).toContain('lg:relative');
      expect(chatFile).toContain('lg:hidden fixed inset-0 bg-black');
    });
  });

  describe('7. Buttons & User Feedback Guards', () => {
    it('verifies Quick Join input validates room code and displays helpful error', () => {
      const landingFile = fs.readFileSync(path.join(rootDir, 'src/pages/LandingPage.tsx'), 'utf-8');
      expect(landingFile).toContain('joinError');
      expect(landingFile).toContain('setJoinError');
    });

    it('verifies Share Modal and Settings Modal close on backdrop click and Escape key', () => {
      const shareModal = fs.readFileSync(path.join(rootDir, 'src/components/room/RoomShareModal.tsx'), 'utf-8');
      const settingsModal = fs.readFileSync(path.join(rootDir, 'src/components/room/SettingsModal.tsx'), 'utf-8');

      expect(shareModal).toContain('closeShareModal');
      expect(shareModal).toContain('stopPropagation()');
      expect(shareModal).toContain('Escape');

      expect(settingsModal).toContain('closeSettings');
      expect(settingsModal).toContain('stopPropagation()');
      expect(settingsModal).toContain('Escape');
    });
  });

  describe('8. Phase 19.1 Strict Design Standards & Authentic Content Policy', () => {
    const getAllFiles = (dir: string, ext: string[] = ['.ts', '.tsx', '.html', '.css']): string[] => {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          results = results.concat(getAllFiles(filePath, ext));
        } else if (ext.some(e => file.endsWith(e))) {
          results.push(filePath);
        }
      }
      return results;
    };

    it('enforces ZERO em dashes (—) anywhere across src/ and index.html', () => {
      const srcFiles = getAllFiles(path.join(rootDir, 'src'));
      const indexHtml = path.join(rootDir, 'index.html');
      const allFiles = [...srcFiles, indexHtml];

      for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content.includes('—'), `Found em dash in ${path.relative(rootDir, file)}`).toBe(false);
      }
    });

    it('enforces ZERO purple or violet gradients across src/', () => {
      const srcFiles = getAllFiles(path.join(rootDir, 'src'));
      for (const file of srcFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).not.toMatch(/bg-gradient-to|from-purple|to-purple|from-violet|to-violet/);
      }
    });

    it('enforces NO rounded-3xl elements across src/', () => {
      const srcFiles = getAllFiles(path.join(rootDir, 'src'));
      for (const file of srcFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content.includes('rounded-3xl'), `Found rounded-3xl in ${path.relative(rootDir, file)}`).toBe(false);
      }
    });

    it('verifies authentic legal policies with clear review notices and no fake claims', () => {
      const privacyContent = fs.readFileSync(path.join(rootDir, 'src/pages/PrivacyPage.tsx'), 'utf-8');
      const termsContent = fs.readFileSync(path.join(rootDir, 'src/pages/TermsPage.tsx'), 'utf-8');

      expect(privacyContent).toContain('anonymous Supabase authentication session');
      expect(privacyContent).toContain('Ephemeral Chat and Reactions');
      expect(privacyContent).toContain('Zero Video Storage and Processing');
      expect(privacyContent).toContain('Notice for Owner Review:');

      expect(termsContent).toContain('Private Two-Person Scope');
      expect(termsContent).toContain('YouTube API Compliance');
      expect(termsContent).toContain('Peer-to-Peer Network Limitations');
      expect(termsContent).toContain('Notice for Owner Review:');
    });

    it('verifies zero AI branding or Made with AI tags exist', () => {
      const srcFiles = getAllFiles(path.join(rootDir, 'src'));
      const indexHtml = path.join(rootDir, 'index.html');
      for (const file of [...srcFiles, indexHtml]) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).not.toMatch(/Made with AI|Powered by Lovable|Built with v0|Created with Bolt/i);
      }
    });
  });
});

