import { describe, it, expect } from 'vitest';
import { getDashboardHTML, getErrorHTML } from '../../core/dashboard.js';

describe('dashboard', () => {
  describe('getDashboardHTML', () => {
    it('generates valid HTML structure', () => {
      const html = getDashboardHTML();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
    });

    it('includes default title', () => {
      const html = getDashboardHTML();
      expect(html).toContain('<title>Reflexive</title>');
    });

    it('accepts custom title', () => {
      const html = getDashboardHTML({ title: 'My App' });
      expect(html).toContain('<title>My App</title>');
    });

    it('escapes HTML in title', () => {
      const html = getDashboardHTML({ title: '<script>alert(1)</script>' });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('includes entry path when provided', () => {
      const html = getDashboardHTML({ status: { entry: '/path/to/app.js' } });
      expect(html).toContain('/path/to/app.js');
    });

    it('shows running status by default', () => {
      const html = getDashboardHTML();
      expect(html).toContain('dot running');
      expect(html).toContain('Running');
    });

    it('shows controls when showControls is true', () => {
      const html = getDashboardHTML({ showControls: true });
      expect(html).toContain('id="start-btn"');
      expect(html).toContain('id="restart-btn"');
      expect(html).toContain('id="stop-btn"');
    });

    it('hides controls by default', () => {
      const html = getDashboardHTML();
      expect(html).not.toContain('id="start-btn"');
    });

    it('disables start button when running', () => {
      const html = getDashboardHTML({
        showControls: true,
        status: { isRunning: true }
      });
      expect(html).toContain('id="start-btn" disabled');
    });

    it('disables stop button when stopped', () => {
      const html = getDashboardHTML({
        showControls: true,
        status: { isRunning: false }
      });
      expect(html).toContain('id="stop-btn" disabled');
    });

    it('includes chat interface elements', () => {
      const html = getDashboardHTML();
      expect(html).toContain('id="messages"');
      expect(html).toContain('id="input"');
      expect(html).toContain('id="send"');
    });

    it('includes logs container', () => {
      const html = getDashboardHTML();
      expect(html).toContain('id="logs"');
    });

    it('includes metrics display', () => {
      const html = getDashboardHTML();
      expect(html).toContain('id="m-pid"');
      expect(html).toContain('id="m-uptime"');
    });

    it('shows restarts metric in control mode', () => {
      const html = getDashboardHTML({ showControls: true });
      expect(html).toContain('id="m-restarts"');
    });

    it('hides restarts metric in library mode', () => {
      const html = getDashboardHTML({ showControls: false });
      expect(html).not.toContain('id="m-restarts"');
    });

    it('includes status values', () => {
      const html = getDashboardHTML({
        status: {
          pid: 12345,
          uptime: 120,
          restartCount: 3
        },
        showControls: true
      });
      expect(html).toContain('12345');
      expect(html).toContain('120s');
      expect(html).toContain('>3<');
    });

    it('includes CSS styles', () => {
      const html = getDashboardHTML();
      expect(html).toContain('<style>');
      expect(html).toContain('</style>');
      expect(html).toContain('font-family');
    });

    it('includes JavaScript', () => {
      const html = getDashboardHTML();
      expect(html).toContain('<script>');
      expect(html).toContain('</script>');
      expect(html).toContain('sendMessage');
    });

    it('uses custom endpoints', () => {
      const html = getDashboardHTML({
        logsEndpoint: '/custom/logs',
        statusEndpoint: '/custom/status',
        chatEndpoint: '/custom/chat'
      });
      expect(html).toContain('/custom/logs');
      expect(html).toContain('/custom/status');
      expect(html).toContain('/custom/chat');
    });

    it('includes marked.js for markdown rendering', () => {
      const html = getDashboardHTML();
      expect(html).toContain('marked');
    });
  });

  describe('getErrorHTML', () => {
    it('generates valid HTML structure', () => {
      const html = getErrorHTML('Error', 'Something went wrong');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('includes title', () => {
      const html = getErrorHTML('Not Found', 'Page not found');
      expect(html).toContain('<title>Error - Not Found</title>');
    });

    it('includes error message', () => {
      const html = getErrorHTML('Server Error', 'Internal server error occurred');
      expect(html).toContain('Internal server error occurred');
    });

    it('escapes HTML in content', () => {
      const html = getErrorHTML('<script>bad</script>', '<img onerror="bad">');
      expect(html).not.toContain('<script>bad</script>');
      expect(html).not.toContain('<img onerror');
    });

    it('applies error styling', () => {
      const html = getErrorHTML('Error', 'Message');
      expect(html).toContain('#ef4444'); // Red color for error
    });
  });
});
