/**
 * Render tests for ThemeControl component
 * Author: sadhak001@gmail.com
 * Created: 2026-10-29
 * Scope: ThemeControl renders accessible select with Light / Dark / System options
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
   * Scenario: Component mounts
   * Slice: render
   * Given no stored theme,
   * When ThemeControl renders,
   * Then a "Theme" label is visible.
   */
  it('renders a Theme label', () => {
    render(<ThemeControl />);
    expect(screen.getByText('Theme')).toBeTruthy();
  });

  /**
   * Scenario: All three options present
   * Slice: options
   * Given ThemeControl renders,
   * When the select is inspected,
   * Then Light, Dark, and System options exist.
   */
  it('exposes Light, Dark, and System options', () => {
    render(<ThemeControl />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('light');
    expect(values).toContain('dark');
    expect(values).toContain('system');
  });

  /**
   * Scenario: Default selection matches stored theme
   * Slice: initial value
   * Given no stored theme (defaults to light),
   * When ThemeControl renders,
   * Then the select value is 'light'.
   */
  it('defaults to light when no theme is stored', () => {
    render(<ThemeControl />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('light');
  });

  /**
   * Scenario: Changing the select updates data-theme
   * Slice: interaction
   * Given ThemeControl is rendered,
   * When the user switches to 'dark',
   * Then document.documentElement.dataset.theme is 'dark'.
   */
  it('applies the selected theme to the document root', () => {
    render(<ThemeControl />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  /**
   * Scenario: Select is accessible
   * Slice: accessibility
   * Given ThemeControl renders,
   * When queried by accessible label,
   * Then the select is found.
   */
  it('has an accessible aria-label on the select', () => {
    render(<ThemeControl />);
    expect(screen.getByLabelText('Colour theme')).toBeTruthy();
  });
});
