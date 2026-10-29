/**
 * Render tests for ThemeControl component
 * Author: sadhak001@gmail.com
 * Created: 2026-10-29
 * Scope: ThemeControl renders a compact, accessible Light / Dark / System toggle
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeControl } from '../components/ThemeControl';

describe('ThemeControl', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  /**
   * Scenario: Toggle is accessible as a group
   * Slice: accessibility
   * Given ThemeControl renders,
   * When queried by accessible label,
   * Then a "Colour theme" group is found.
   */
  it('renders an accessible "Colour theme" group', () => {
    render(<ThemeControl />);
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy();
  });

  /**
   * Scenario: All three options present
   * Slice: options
   * Given ThemeControl renders,
   * When the buttons are inspected,
   * Then Light, Dark, and System buttons exist.
   */
  it('exposes Light, Dark, and System buttons', () => {
    render(<ThemeControl />);
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'System theme' })).toBeTruthy();
  });

  /**
   * Scenario: Default selection matches stored theme
   * Slice: initial value
   * Given no stored theme (defaults to light),
   * When ThemeControl renders,
   * Then only the Light button is pressed.
   */
  it('defaults to light when no theme is stored', () => {
    render(<ThemeControl />);
    expect(screen.getByRole('button', { name: 'Light theme' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Dark theme' }).getAttribute('aria-pressed')).toBe('false');
  });

  /**
   * Scenario: Clicking a button updates data-theme
   * Slice: interaction
   * Given ThemeControl is rendered,
   * When the user clicks Dark,
   * Then document.documentElement.dataset.theme is 'dark' and Dark is pressed.
   */
  it('applies the selected theme to the document root', () => {
    render(<ThemeControl />);
    const dark = screen.getByRole('button', { name: 'Dark theme' });
    fireEvent.click(dark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(dark.getAttribute('aria-pressed')).toBe('true');
  });
});
