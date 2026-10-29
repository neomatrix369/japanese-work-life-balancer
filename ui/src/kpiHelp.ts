/**
 * Single source of truth for KPI help texts.
 * Used by KpiCards (info tooltips) and the guided tour.
 *
 * Keys match the KPI card label strings exactly.
 */
export const KPI_HELP: Readonly<Record<string, string>> = {
  'Healthy share':
    'Share of employees whose longest stretch of back-to-back working days is 2 or fewer, counting days already worked just before Monday. Short stretches leave time to recover.',
  'At-risk employees':
    'Employees who work 3 or more days in a row at some point this week, including days already worked before Monday. Long stretches without a day off are linked to fatigue and burnout (karoshi).',
  'Avg consecutive days':
    'Average of each employee’s longest run of back-to-back working days (including carry-in). Lower is healthier.',
  'Idle hours total':
    'Hours people are available on days they come in but have no task — paid waiting time.',
  'Labor cost':
    'What we pay: each employee’s hourly rate × hours of assigned tasks.',
  'Revenue':
    'What clients pay: billing rate × hours of assigned tasks.',
  'Profit':
    'Revenue minus labor cost.',
  'Unassigned tasks':
    'Tasks no one could take without breaking a hard rule (skills, availability, holidays, hours or rest). Each has a reason in the Unassigned panel.',
};
