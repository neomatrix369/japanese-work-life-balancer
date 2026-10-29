import React from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import type { WorkSchedule, PerEmployeeKpi } from '../api';

interface HoursChartProps {
  schedule: WorkSchedule;
  perEmployee: Record<string, PerEmployeeKpi>;
}

interface ChartEntry {
  name: string;
  hours: number;
  weeklyMax: number;
  atRisk: boolean;
}

// Custom bar shape that draws a horizontal line at the 'weeklyMax' level
function MaxLimitShape(props: unknown) {
  const p = props as { x?: number; y?: number; width?: number };
  const { x, y, width } = p;
  if (typeof y !== 'number' || typeof x !== 'number' || typeof width !== 'number') return null;
  return (
    <line
      x1={x}
      y1={y}
      x2={x + width}
      y2={y}
      style={{ stroke: 'var(--warn)', strokeWidth: 2.5 }}
      strokeDasharray="5 3"
    />
  );
}

export function HoursChart({ schedule, perEmployee }: HoursChartProps) {
  const data: ChartEntry[] = schedule.employees.map((emp) => {
    const kpi = perEmployee[emp.id];
    return {
      name: emp.name.split(' ')[0], // First name only for readability
      hours: kpi?.totalHours ?? 0,
      // Use the limit from the KPI object when present (it may differ from the employee's
      // static profile if the solver has adjusted it); fall back to the employee record.
      weeklyMax: kpi?.maxHoursPerWeek ?? emp.maxHoursPerWeek,
      atRisk: kpi?.atRisk ?? false,
    };
  });

  if (data.length === 0) return null;

  const title = (
    <>
      Hours per Employee
      <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 11, color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>
        dashed line = weekly limit
      </span>
    </>
  );

  return (
    <CollapsiblePanel id="hours-chart" title={title} dataTour="hours-chart" defaultOpen={true}>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
            barCategoryGap="25%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
              angle={-40}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
              unit="h"
            />
            <Tooltip
              formatter={(value: number, name: string) =>
                name === 'Hours worked'
                  ? [`${value.toFixed(1)} h`, name]
                  : [`${value} h`, name]
              }
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />

            {/* Actual hours bar — colored green/amber/red by atRisk */}
            <Bar dataKey="hours" name="Hours worked" isAnimationActive={false}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    entry.atRisk
                      ? 'var(--chart-3)'
                      : entry.hours >= entry.weeklyMax * 0.9
                      ? 'var(--chart-2)'
                      : 'var(--chart-1)'
                  }
                />
              ))}
            </Bar>

            {/* Weekly limit marker drawn as a dashed tick on top of a zero-height bar */}
            <Bar
              dataKey="weeklyMax"
              name="Weekly limit"
              isAnimationActive={false}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={MaxLimitShape as any}
              fill="transparent"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CollapsiblePanel>
  );
}
