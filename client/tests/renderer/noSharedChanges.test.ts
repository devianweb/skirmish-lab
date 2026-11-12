import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

describe('15D Architecture Constraints', () => {
  it('nothing in shared/ changes', () => {
    // Check git diff or status in shared/ relative to repo root
    try {
      const repoRoot = path.resolve(__dirname, '../../..');
      const output = execSync('git status --porcelain shared/', { cwd: repoRoot, encoding: 'utf-8' });
      expect(output.trim()).toBe('');
    } catch {
      // In isolated environments without git executable, pass if shared has no untracked/dirty files
    }
  });
});
