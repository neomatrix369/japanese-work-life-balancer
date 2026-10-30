import React, { useEffect } from 'react';
import { X, ShieldCheck, TrendingDown, Clock, Users, Cpu, AlertTriangle, Info } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function AboutModal({ onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About this system" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="about-modal">
        <div className="about-header">
          <div className="about-header-text">
            <h1>How the Work-Life Balancer works</h1>
            <p>Every number, colour and rule in the dashboard explained.</p>
          </div>
          <button className="about-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="about-body">

          {/* ── The Problem ── */}
          <section className="about-section">
            <h2><AlertTriangle size={16} aria-hidden="true" /> The problem: karoshi</h2>
            <p>
              <strong>Karoshi</strong> (過労死) means "death from overwork" — a documented crisis in Japan and increasingly
              visible in London's care, hospitality and Japanese-firm offices. When managers schedule a week manually they
              optimise for coverage and cost; health falls through the gaps. This tool flips that default: health is a hard
              rule the solver can never break, and you see the monetary cost of protecting your staff in real time.
            </p>
          </section>

          {/* ── How the solver works ── */}
          <section className="about-section">
            <h2><Cpu size={16} aria-hidden="true" /> How the solver works</h2>
            <p>
              The planner uses <strong>Timefold Solver</strong> — a constraint-satisfaction engine. It explores millions
              of possible assignments (which employee does which task on which day) and converges on the best feasible
              plan within the time limit (default 30 s). "Best" means: first, break zero hard rules; second, leave as few
              tasks unassigned as possible; third, optimise health and cost preferences.
            </p>
            <div className="about-score-box">
              <div className="about-score-item bad">
                <span className="about-score-label">Hard score</span>
                <code>0hard</code>
                <span className="about-score-desc">Feasibility — must always be zero. One hard violation = plan is unusable.</span>
              </div>
              <div className="about-score-item warn">
                <span className="about-score-label">Medium score</span>
                <code>0med</code>
                <span className="about-score-desc">Unassigned tasks — the solver maximises coverage before touching soft goals.</span>
              </div>
              <div className="about-score-item good">
                <span className="about-score-label">Soft score</span>
                <code>−Nsoft</code>
                <span className="about-score-desc">Preferences — closer to zero is better. Weights change per preset.</span>
              </div>
            </div>
          </section>

          {/* ── Hard constraints ── */}
          <section className="about-section">
            <h2><ShieldCheck size={16} aria-hidden="true" /> Hard constraints — never broken</h2>
            <p>A plan that breaks even one of these is infeasible and will never be shown.</p>
            <table className="about-table">
              <thead>
                <tr><th>Constraint</th><th>What it protects</th><th>Penalty unit</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Required skills</td>
                  <td>Tasks only go to employees who hold every required skill</td>
                  <td>per missing skill</td>
                </tr>
                <tr>
                  <td>Availability</td>
                  <td>Employees only work on days and hours they are available</td>
                  <td>minutes outside window</td>
                </tr>
                <tr>
                  <td>Approved holiday</td>
                  <td>Employees are never assigned on their approved holiday days</td>
                  <td>task minutes</td>
                </tr>
                <tr>
                  <td>Public holiday</td>
                  <td>No tasks or shifts on company-wide closed days (e.g. Culture Day)</td>
                  <td>task minutes</td>
                </tr>
                <tr>
                  <td>Task within shift</td>
                  <td>Tasks must fall entirely within the 09:00–17:00 shift window</td>
                  <td>minutes outside shift</td>
                </tr>
                <tr>
                  <td>One task at a time</td>
                  <td>An employee cannot do two overlapping tasks — one person, one place</td>
                  <td>overlap minutes</td>
                </tr>
                <tr>
                  <td>Max hours per day</td>
                  <td>Total task hours per employee per day never exceed their personal daily limit (4, 6 or 8 h)</td>
                  <td>excess minutes</td>
                </tr>
                <tr>
                  <td>Max hours per week</td>
                  <td>Total task hours per employee never exceed their weekly cap (20, 30 or 40 h)</td>
                  <td>excess minutes</td>
                </tr>
                <tr>
                  <td>Minimum rest</td>
                  <td>Rest between consecutive working days must meet the employee's minimum (11–24 h). Employees whose minimum is &gt;16 h cannot work consecutive days.</td>
                  <td>missing rest hours</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* ── Soft constraints & presets ── */}
          <section className="about-section">
            <h2><TrendingDown size={16} aria-hidden="true" /> Soft constraints &amp; presets</h2>
            <p>
              Soft constraints are preferences — the solver minimises their total weighted penalty. The three presets
              change only the weights; hard and medium rules are identical in every preset.
            </p>
            <table className="about-table">
              <thead>
                <tr>
                  <th>Constraint</th>
                  <th>Formula / unit</th>
                  <th className="preset health-first-col">health-first<br/><span className="preset-note">(default)</span></th>
                  <th className="preset balanced-col">balanced</th>
                  <th className="preset cost-first-col">cost-first</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Consecutive days risk</td>
                  <td>
                    <code>(run − 2) × 480 min</code> per run ≥ 3 days<br/>
                    <small>+ 2,400 min flat charge per at-risk employee (drives headcount down)</small>
                  </td>
                  <td className="w-10 health-first-col">10</td>
                  <td className="w-1 balanced-col">1</td>
                  <td className="w-0 cost-first-col">0 (report only)</td>
                </tr>
                <tr>
                  <td>Requested day off</td>
                  <td><code>480 min</code> per date the employee asked to have off</td>
                  <td className="w-3 health-first-col">3</td>
                  <td className="w-1 balanced-col">1</td>
                  <td className="w-1 cost-first-col">1</td>
                </tr>
                <tr>
                  <td>Avoided hours</td>
                  <td>Minutes of task overlap with the employee's preferred-off time windows</td>
                  <td className="w-2 health-first-col">2</td>
                  <td className="w-1 balanced-col">1</td>
                  <td className="w-1 cost-first-col">1</td>
                </tr>
                <tr>
                  <td>Idle hours</td>
                  <td>Available minutes on worked days minus task minutes on those days</td>
                  <td className="w-1 health-first-col">1</td>
                  <td className="w-1 balanced-col">1</td>
                  <td className="w-3 cost-first-col">3</td>
                </tr>
                <tr>
                  <td>Labor cost</td>
                  <td><code>hourlyRate × taskHours ÷ 100</code> (per ¥100 — so weights are comparable to minutes)</td>
                  <td className="w-1 health-first-col">1</td>
                  <td className="w-1 balanced-col">1</td>
                  <td className="w-5 cost-first-col">5</td>
                </tr>
              </tbody>
            </table>
            <p className="about-note">
              <strong>cost-first</strong> reproduces the original PRD's "health is report-only" mode — it's the baseline
              that shows what an unconstrained plan looks like. The compare panel lets you see exactly how many fewer
              at-risk employees <strong>health-first</strong> produces, and what that costs in money.
            </p>
          </section>

          {/* ── KPI formulas ── */}
          <section className="about-section">
            <h2><Clock size={16} aria-hidden="true" /> KPI formulas — where each number comes from</h2>

            <h3>Health KPIs</h3>
            <dl className="about-dl">
              <dt>Consecutive days (per person)</dt>
              <dd>Days worked in a row, including days already worked before the planning week (<em>carry-in</em>). A holiday or public holiday resets the run to zero. Three or more days in a row = <strong className="bad-text">at risk</strong>.</dd>

              <dt>At-risk count</dt>
              <dd>Number of employees whose longest run in the solved week ≥ 3 days. Shown as a headcount (e.g. "4 people"). The grid colours cells: green for days 1–2, amber for day 3, red for day 4+.</dd>

              <dt>Healthy share</dt>
              <dd><code>employees with max run &lt; 3 ÷ total employees × 100%</code>. Higher is better.</dd>

              <dt>Avg consecutive days</dt>
              <dd>Mean of each employee's longest consecutive-day run in the week.</dd>

              <dt>Idle hours</dt>
              <dd>For each employee on each day they work: <code>available minutes that day − task minutes assigned that day</code>. Summed across all employees. An employee who is "available 8 h but only has 5 h of tasks" contributes 3 idle hours.</dd>
            </dl>

            <h3>Business KPIs</h3>
            <dl className="about-dl">
              <dt>Labor cost</dt>
              <dd><code>sum of (employee hourlyRate × task hours)</code> across all assigned tasks. Only task time is billed — idle time on shift is free. Rates are in JPY (¥1,500–¥3,500 / h in the synthetic data).</dd>

              <dt>Revenue</dt>
              <dd><code>sum of (employee billingRate × task hours)</code>. The billing rate is what the company charges the client for that employee's work. It is always higher than the hourly rate (1.5–2.5× in the synthetic data).</dd>

              <dt>Profit</dt>
              <dd><code>revenue − labor cost</code>. An unassigned task earns zero revenue.</dd>

              <dt>Unassigned tasks</dt>
              <dd>Tasks the solver could not assign without breaking a hard rule. Each one shows a reason: <em>public holiday</em>, <em>no skilled employee</em>, <em>no skilled employee available</em>, or <em>capacity</em>.</dd>
            </dl>

            <h3>Currency</h3>
            <dl className="about-dl">
              <dt>All values are stored in JPY</dt>
              <dd>The UI converts on the fly using fixed indicative rates: <code>1 USD = 150 JPY</code>, <code>1 GBP = 195 JPY</code>. These are approximate and marked "indicative" throughout the app.</dd>
            </dl>
          </section>

          {/* ── Week grid colour key ── */}
          <section className="about-section">
            <h2>Week grid colour key</h2>
            <div className="about-color-key">
              <div className="about-color-item">
                <span className="color-swatch" style={{ background: 'var(--neutral-bg)', border: '1px solid var(--border)' }} />
                <div>
                  <strong>Not working</strong>
                  <span>No tasks assigned that day</span>
                </div>
              </div>
              <div className="about-color-item">
                <span className="color-swatch" style={{ background: 'var(--good-bg)', border: '1px solid var(--good)' }} />
                <div>
                  <strong>Day 1–2 of a run (green)</strong>
                  <span>Within safe consecutive-day threshold</span>
                </div>
              </div>
              <div className="about-color-item">
                <span className="color-swatch" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn)' }} />
                <div>
                  <strong>Day 3 of a run (amber)</strong>
                  <span>At-risk threshold reached — penalty kicks in</span>
                </div>
              </div>
              <div className="about-color-item">
                <span className="color-swatch" style={{ background: 'var(--bad-bg)', border: '1px solid var(--bad)' }} />
                <div>
                  <strong>Day 4+ of a run (red)</strong>
                  <span>Extended overwork — higher penalty per extra day</span>
                </div>
              </div>
              <div className="about-color-item">
                <span className="color-swatch" style={{ background: 'var(--holiday-blue-bg)', border: '1px solid var(--holiday-blue)' }} />
                <div>
                  <strong>Blue — approved holiday</strong>
                  <span>Employee's approved day off (hard constraint — never overridden)</span>
                </div>
              </div>
              <div className="about-color-item">
                <span className="color-swatch" style={{ background: 'repeating-linear-gradient(45deg, var(--bg-muted) 0 4px, var(--border) 4px 8px)' }} />
                <div>
                  <strong>Hatched — public holiday</strong>
                  <span>Company-wide closed day; no shifts, tasks listed as unassigned</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Scenarios ── */}
          <section className="about-section">
            <h2><Users size={16} aria-hidden="true" /> Scenarios</h2>
            <table className="about-table">
              <thead>
                <tr><th>Name</th><th>Load</th><th>Story / what it tests</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>tiny</code></td>
                  <td>~60%</td>
                  <td>8 employees, ~56 tasks — used for unit tests and quick debugging</td>
                </tr>
                <tr>
                  <td><code>normal</code></td>
                  <td>~50%</td>
                  <td>50 employees, ~250 tasks — a regular week; all tasks should be assigned</td>
                </tr>
                <tr>
                  <td><code>overloaded</code></td>
                  <td>~125%</td>
                  <td>More work than capacity — shows unassigned tasks with reasons; still 0 hard</td>
                </tr>
                <tr>
                  <td><code>holiday</code></td>
                  <td>~80%</td>
                  <td>Culture Day (2026-11-03) + ~10% staff on approved holidays — shows holiday handling</td>
                </tr>
                <tr>
                  <td><code>burnout</code></td>
                  <td>~55%</td>
                  <td>~30% of staff carry in 2–5 consecutive days before the week starts — <strong>best scenario for comparing presets</strong></td>
                </tr>
              </tbody>
            </table>
            <p className="about-note">
              All employee names and company figures are <strong>synthetic and fictional</strong>. No real personal data,
              health records or company information is used anywhere.
            </p>
          </section>

          {/* ── What's mocked ── */}
          <section className="about-section">
            <h2><Info size={16} aria-hidden="true" /> Hackathon shortcuts (marked MOCK in the code)</h2>
            <ul className="about-list">
              <li><strong>No persistence</strong> — solve jobs live in memory; restarting the model clears them.</li>
              <li><strong>No authentication</strong> — the role selector (Manager / HR / Executive) is a UI widget only; there is no login or access control.</li>
              <li><strong>Fixed FX rates</strong> — 1 USD = 150 JPY, 1 GBP = 195 JPY, labelled "indicative" throughout.</li>
              <li><strong>Invented retention figures</strong> — company retention data (year-1: 88%, year-3: 74%, year-5: 63%) is synthetic.</li>
              <li><strong>Shifts are derived, not planned</strong> — a "shift" is any day an employee has at least one task; the solver assigns tasks, not shifts.</li>
              <li><strong>KPIs computed after solving</strong> — idle hours, labor cost and other metrics are calculated in plain Java once the solver finishes, not as live shadow variables.</li>
              <li><strong>Broken-constraint match counts show "–"</strong> — Timefold Solver 2.7 Community edition does not return per-match counts. Enterprise edition would show exact counts.</li>
            </ul>
          </section>

          {/* ── Tech stack ── */}
          <section className="about-section about-section-last">
            <h2>Tech stack</h2>
            <div className="about-stack">
              <div className="about-stack-item">
                <strong>Model</strong>
                <span>Java 21 · Quarkus · Timefold Solver 2.7<br/>Stateless REST on :8083 · 30 s solve time</span>
              </div>
              <div className="about-stack-item">
                <strong>Data generator</strong>
                <span>Python 3.11 · stdlib only · seeded (--seed 42)<br/>5 synthetic JSON scenarios</span>
              </div>
              <div className="about-stack-item">
                <strong>Dashboard</strong>
                <span>Vite · React · TypeScript · Recharts<br/>Light / dark · JPY / USD / GBP · on :5173</span>
              </div>
              <div className="about-stack-item">
                <strong>MCP server</strong>
                <span>Python MCP SDK v2 · streamable HTTP on :8765<br/>7 tools — lets Claude drive the solver</span>
              </div>
            </div>
            <p className="about-note" style={{ marginTop: '1rem' }}>
              Built at Hack for Humanity London 2026-10-29 by <strong>Mani Sarkar</strong> and <strong>Risako</strong>.
              The idea came from Risako, who framed the karoshi problem and wrote the original brief.
              Solver model derived from <a href="https://github.com/TimefoldAI/timefold-quickstarts" target="_blank" rel="noopener noreferrer">TimefoldAI/timefold-quickstarts</a> (Apache-2.0).
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
