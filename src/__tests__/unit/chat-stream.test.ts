import { describe, it, expect, vi } from 'vitest';
import { formatSSEEvent, createMockChatStream } from '../../core/chat-stream.js';
import type { ChatStreamEvent } from '../../types/mcp.js';

describe('chat-stream', () => {
  describe('formatSSEEvent', () => {
    it('formats text event', () => {
      const event: ChatStreamEvent = { type: 'text', content: 'Hello' };
      const formatted = formatSSEEvent(event);
      expect(formatted).toBe('data: {"type":"text","content":"Hello"}\n\n');
    });

    it('formats session event', () => {
      const event: ChatStreamEvent = { type: 'session', sessionId: '123' };
      const formatted = formatSSEEvent(event);
      expect(formatted).toBe('data: {"type":"session","sessionId":"123"}\n\n');
    });

    it('formats tool event', () => {
      const event: ChatStreamEvent = {
        type: 'tool',
        name: 'get_logs',
        input: { count: 10 }
      };
      const formatted = formatSSEEvent(event);
      expect(formatted).toContain('"type":"tool"');
      expect(formatted).toContain('"name":"get_logs"');
      expect(formatted).toContain('"count":10');
    });

    it('formats done event', () => {
      const event: ChatStreamEvent = { type: 'done' };
      const formatted = formatSSEEvent(event);
      expect(formatted).toBe('data: {"type":"done"}\n\n');
    });

    it('formats error event', () => {
      const event: ChatStreamEvent = { type: 'error', message: 'Something went wrong' };
      const formatted = formatSSEEvent(event);
      expect(formatted).toContain('"type":"error"');
      expect(formatted).toContain('Something went wrong');
    });
  });

  describe('createMockChatStream', () => {
    it('yields session event first', async () => {
      const stream = createMockChatStream('test');
      const events: ChatStreamEvent[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events[0].type).toBe('session');
      if (events[0].type === 'session') {
        expect(events[0].sessionId).toBe('mock-session-123');
      }
    });

    it('streams text character by character', async () => {
      const response = 'Hi';
      const stream = createMockChatStream(response);
      const textEvents: ChatStreamEvent[] = [];

      for await (const event of stream) {
        if (event.type === 'text') {
          textEvents.push(event);
        }
      }

      expect(textEvents).toHaveLength(2);
      expect(textEvents[0].type === 'text' && textEvents[0].content).toBe('H');
      expect(textEvents[1].type === 'text' && textEvents[1].content).toBe('i');
    });

    it('yields done event at end', async () => {
      const stream = createMockChatStream('test');
      const events: ChatStreamEvent[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe('done');
    });

    it('uses default response when none provided', async () => {
      const stream = createMockChatStream();
      let fullText = '';

      for await (const event of stream) {
        if (event.type === 'text') {
          fullText += event.content;
        }
      }

      expect(fullText).toBe('This is a mock response.');
    });
  });
});
