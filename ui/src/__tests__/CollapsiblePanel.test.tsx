/**
 * Author: Japanese Work-Life Balancer team
 * Created: 2026-10-29
 * Scope: CollapsiblePanel — render, toggle, localStorage persistence, and error resilience.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CollapsiblePanel } from '../components/CollapsiblePanel';

const LS_KEY = (id: string) => `jwlb.panel.${id}`;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('CollapsiblePanel', () => {
  it('renders open by default when defaultOpen is true and no localStorage entry exists', () => {
    /**
     * Scenario: first visit, no prior preference stored.
     * Slice: collapsible panel state.
     * Given no localStorage entry, when rendered with defaultOpen=true, then the details
     * element is open and the children are present in the DOM.
     */
    // -- Given --
    // (nothing in localStorage)
    // -- When --
    const { container } = render(
      <CollapsiblePanel id="panel-open" title="My Panel">
        <p>Panel content</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(screen.getByText('Panel content')).toBeInTheDocument();
  });

  it('renders closed when defaultOpen is false and no localStorage entry exists', () => {
    /**
     * Scenario: compare panel is collapsed by design on first visit.
     * Slice: collapsible panel state.
     * Given no localStorage entry, when rendered with defaultOpen=false, then the
     * details element starts closed.
     */
    // -- Given --
    // -- When --
    const { container } = render(
      <CollapsiblePanel id="panel-closed" title="Closed Panel" defaultOpen={false}>
        <p>Hidden content</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it('reads open=true from localStorage, overriding defaultOpen=false', () => {
    /**
     * Scenario: user previously expanded the compare panel.
     * Slice: collapsible panel persistence.
     * Given localStorage says "true" for this panel, when rendered with defaultOpen=false,
     * then the panel opens (localStorage wins).
     */
    // -- Given --
    localStorage.setItem(LS_KEY('panel-ls-open'), 'true');
    // -- When --
    const { container } = render(
      <CollapsiblePanel id="panel-ls-open" title="LS Open" defaultOpen={false}>
        <p>Visible</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });

  it('reads open=false from localStorage, overriding defaultOpen=true', () => {
    /**
     * Scenario: user previously collapsed the health KPI panel.
     * Slice: collapsible panel persistence.
     * Given localStorage says "false", when rendered with defaultOpen=true, then the
     * panel starts closed (localStorage wins).
     */
    // -- Given --
    localStorage.setItem(LS_KEY('panel-ls-closed'), 'false');
    // -- When --
    const { container } = render(
      <CollapsiblePanel id="panel-ls-closed" title="LS Closed" defaultOpen={true}>
        <p>Content</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it('writes the new state to localStorage when a toggle event fires', () => {
    /**
     * Scenario: user collapses an open panel.
     * Slice: collapsible panel persistence.
     * Given a panel that starts open, when a toggle event fires after the element is closed,
     * then localStorage is updated to "false".
     * Note: JSDOM does not simulate native <details>/<summary> interactive behaviour
     * (no automatic toggle on summary click); we dispatch the toggle event manually.
     */
    // -- Given --
    const { container } = render(
      <CollapsiblePanel id="panel-toggle" title="Toggle Me" defaultOpen={true}>
        <p>Content</p>
      </CollapsiblePanel>,
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    // -- When -- close and fire toggle (as the browser would after a summary click)
    details.open = false;
    fireEvent(details, new Event('toggle'));
    // -- Then --
    expect(localStorage.getItem(LS_KEY('panel-toggle'))).toBe('false');
  });

  it('falls back to defaultOpen when localStorage.getItem throws', () => {
    /**
     * Scenario: user is in a restricted context (iOS private browsing, security policy).
     * Slice: collapsible panel resilience.
     * Given localStorage.getItem throws a SecurityError, when rendered with defaultOpen=true,
     * then the panel still opens without any uncaught error.
     */
    // -- Given --
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: Blocked a frame with origin from accessing localStorage');
    });
    // -- When / Then -- no throw
    const { container } = render(
      <CollapsiblePanel id="panel-ls-throws" title="Fallback" defaultOpen={true}>
        <p>Visible</p>
      </CollapsiblePanel>,
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });

  it('does not throw when localStorage.setItem throws on toggle', () => {
    /**
     * Scenario: localStorage is full (QuotaExceededError).
     * Slice: collapsible panel resilience.
     * Given localStorage.setItem throws, when the user toggles the panel, then no
     * uncaught error propagates.
     */
    // -- Given --
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { container } = render(
      <CollapsiblePanel id="panel-setitem-throw" title="No Crash" defaultOpen={true}>
        <p>Content</p>
      </CollapsiblePanel>,
    );
    const summary = container.querySelector('summary') as HTMLElement;
    // -- When / Then -- must not throw
    expect(() => fireEvent.click(summary)).not.toThrow();
  });

  it('renders title and summaryExtra inside the summary element', () => {
    /**
     * Scenario: a panel summary has a badge next to its title (e.g. unassigned task count).
     * Slice: collapsible panel rendering.
     * Given title="Tasks" and summaryExtra=<span data-testid="badge">3</span>,
     * when rendered, then both appear inside the <summary>.
     */
    // -- Given / When --
    render(
      <CollapsiblePanel
        id="panel-extras"
        title="Tasks"
        summaryExtra={<span data-testid="badge">3</span>}
      >
        <p>Content</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const summary = document.querySelector('summary')!;
    expect(summary).toHaveTextContent('Tasks');
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(summary).toContainElement(screen.getByTestId('badge'));
  });

  it('sets data-tour on the details element when dataTour is provided', () => {
    /**
     * Scenario: the guided tour needs to target a collapsible panel by data-tour attribute.
     * Slice: tour integration.
     * Given dataTour="longevity", when rendered, then the <details> element has that attribute.
     */
    // -- Given / When --
    const { container } = render(
      <CollapsiblePanel id="panel-tour" title="Longevity" dataTour="longevity">
        <p>Content</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.getAttribute('data-tour')).toBe('longevity');
  });

  it('applies extra className to the details element', () => {
    /**
     * Scenario: KPI group panel needs flex-child classes.
     * Slice: collapsible panel layout.
     * Given className="kpi-group", when rendered, then the details element has both
     * panel-collapsible and kpi-group classes.
     */
    // -- Given / When --
    const { container } = render(
      <CollapsiblePanel id="panel-class" title="Test" className="kpi-group">
        <p>Content</p>
      </CollapsiblePanel>,
    );
    // -- Then --
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.classList.contains('panel-collapsible')).toBe(true);
    expect(details.classList.contains('kpi-group')).toBe(true);
  });
});
