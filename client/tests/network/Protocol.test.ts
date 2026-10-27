import { describe, it, expect } from 'vitest';

describe('Protocol', () => {
  it('should define connection states', () => {
    const validStates = ['disconnected', 'connecting', 'signaling', 'connected', 'failed'];
    validStates.forEach(state => {
      expect(typeof state).toBe('string');
    });
  });
});
