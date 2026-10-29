/**
 * Unit tests for src/theme.ts
 * Author: sadhak001@gmail.com
 * Created: 2026-10-29
 * Scope: getStoredTheme / setTheme — default, persistence, localStorage error resilience
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getStoredTheme, setTheme } from '../theme';

describe('getStoredTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Scenario: No theme stored yet
   * Slice: default
   * Given localStorage is empty,
   * When getStoredTheme() is called,
   * Then it returns 'light'.
   */
  it('returns light when nothing is stored', () => {
    expect(getStoredTheme()).toBe('light');
  });

  /**
   * Scenario: Valid theme stored
   * Slice: persistence
   * Given 'dark' was written to localStorage,
   * When getStoredTheme() is called,
   * Then it returns 'dark'.
   */
  it('returns stored dark theme', () => {
    localStorage.setItem('theme', 'dark');
    expect(getStoredTheme()).toBe('dark');
  });

  /**
   * Scenario: System theme stored
   * Slice: persistence
   * Given 'system' was written to localStorage,
   * When getStoredTheme() is called,
   * Then it returns 'system'.
   */
  it('returns stored system theme', () => {
    localStorage.setItem('theme', 'system');
    expect(getStoredTheme()).toBe('system');
  });

  /**
   * Scenario: Invalid value stored
   * Slice: resilience
   * Given an unknown string is stored,
   * When getStoredTheme() is called,
   * Then it falls back to 'light'.
   */
  it('falls back to light for an unknown stored value', () => {
    localStorage.setItem('theme', 'solarized');
    expect(getStoredTheme()).toBe('light');
  });

  /**
   * Scenario: localStorage throws on read
   * Slice: error resilience
   * Given localStorage.getItem throws (e.g. private browsing),
   * When getStoredTheme() is called,
   * Then it returns 'light' without throwing.
   */
  it('falls back to light when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage blocked');
    });
    expect(getStoredTheme()).toBe('light');
  });
});

describe('setTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Scenario: Set dark theme
   * Slice: persistence + DOM
   * Given the app calls setTheme('dark'),
   * When getStoredTheme() and document root are checked,
   * Then both reflect 'dark'.
   */
  it('persists theme to localStorage and sets data-theme on root', () => {
    setTheme('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  /**
   * Scenario: Round-trip through getStoredTheme
   * Slice: integration
   * Given setTheme('system') then getStoredTheme(),
   * Then the round-trip returns 'system'.
   */
  it('round-trips correctly: set then get', () => {
    setTheme('system');
    expect(getStoredTheme()).toBe('system');
  });

  /**
   * Scenario: localStorage.setItem throws
   * Slice: error resilience
   * Given storage is unavailable,
   * When setTheme('dark') is called,
   * Then it does not throw and still sets data-theme on the document root.
   */
  it('still applies data-theme even when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
