/**
 * Render smoke tests — verify that individual panels render without crashing
 * when fed the real API sample response. No backend required.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { normalizePerEmployee } from '../api';
import type { ScheduleResponse } from '../api';
import { KpiCards } from '../components/KpiCards';
import { UnassignedTable } from '../components/UnassignedTable';
import { BrokenConstraints } from '../components/BrokenConstraints';
import { LongevityView } from '../components/LongevityView';
import { WeekGrid } from '../components/WeekGrid';

import sampleRaw from './fixtures/api-sample-response.json';

const sample = sampleRaw as unknown as ScheduleResponse;
const perEmployee = normalizePerEmployee(sample.perEmployee);

// ---------- KpiCards ----------

describe('KpiCards', () => {
  it('renders without crashing', () => {
    const { container } = render(<KpiCards kpis={sample.kpis} currency="JPY" />);
    expect(container).toBeTruthy();
  });

  it('shows atRiskCount value', () => {
    render(<KpiCards kpis={sample.kpis} currency="JPY" />);
    expect(screen.getByText(String(sample.kpis.atRiskCount))).toBeTruthy();
  });
});

// ---------- UnassignedTable ----------

describe('UnassignedTable', () => {
  it('renders without crashing', () => {
    const { container } = render(<UnassignedTable unassigned={sample.unassigned} />);
    expect(container).toBeTruthy();
  });

  it('displays task name from .name field', () => {
    render(<UnassignedTable unassigned={sample.unassigned} />);
    // Verify the first unassigned task's name is rendered (data-driven)
    const firstName = sample.unassigned[0].name;
    expect(screen.getAllByText(firstName).length).toBeGreaterThan(0);
  });

  it('displays message text', () => {
    render(<UnassignedTable unassigned={sample.unassigned} />);
    expect(screen.getAllByText('All eligible employees are at their limits or busy').length).toBeGreaterThan(0);
  });
});

// ---------- BrokenConstraints ----------

describe('BrokenConstraints', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <BrokenConstraints
        brokenConstraints={sample.brokenConstraints}
        score={sample.score}
      />,
    );
    expect(container).toBeTruthy();
  });

  it('renders null matchCount as "–" without crashing', () => {
    const { container } = render(
      <BrokenConstraints
        brokenConstraints={sample.brokenConstraints}
        score={sample.score}
      />,
    );
    // All matchCount values are null — the rendered output should contain "–" but NOT "×"
    // (×N is only shown when matchCount is non-null)
    expect(container.textContent).toContain('–');
    expect(container.textContent).not.toMatch(/×\d/);
  });
});

// ---------- LongevityView ----------

describe('LongevityView', () => {
  it('renders company-level stats for Manager role without crashing', () => {
    const { container } = render(
      <LongevityView longevity={sample.longevity} role="Manager" />,
    );
    expect(container).toBeTruthy();
  });

  it('renders per-employee table for HR role', () => {
    render(
      <LongevityView
        longevity={sample.longevity}
        role="HR"
        perEmployeeList={Object.values(perEmployee)}
      />,
    );
    expect(screen.getByText('Per-employee detail')).toBeTruthy();
  });
});

// ---------- WeekGrid ----------

describe('WeekGrid', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <WeekGrid
        schedule={sample.schedule}
        perEmployee={perEmployee}
        selectedEmployeeId={null}
        onSelectEmployee={() => undefined}
        currency="JPY"
      />,
    );
    expect(container).toBeTruthy();
  });

  it('renders one row per employee', () => {
    render(
      <WeekGrid
        schedule={sample.schedule}
        perEmployee={perEmployee}
        selectedEmployeeId={null}
        onSelectEmployee={() => undefined}
        currency="JPY"
      />,
    );
    // Each employee name should appear as a cell
    expect(screen.getByText('Aoki Haruto')).toBeTruthy();
    expect(screen.getByText('Sakamoto Rin')).toBeTruthy();
  });
});
