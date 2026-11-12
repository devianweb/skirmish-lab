import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../src/ui/escapeHtml';

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    expect(escapeHtml('<script>alert("xss" & \'test\')</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;test&#39;)&lt;/script&gt;'
    );
  });

  it('leaves safe characters unchanged', () => {
    expect(escapeHtml('Room ABC-123')).toBe('Room ABC-123');
    expect(escapeHtml('Orc Marauders (400 pts)')).toBe('Orc Marauders (400 pts)');
  });

  it('handles null, undefined, empty, and numeric values', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null as any)).toBe('');
    expect(escapeHtml(undefined as any)).toBe('');
    expect(escapeHtml(42 as any)).toBe('42');
  });

  it('escapes image onerror payloads so they cannot render as HTML elements', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const escaped = escapeHtml(payload);
    expect(escaped).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});
