"use client";

import { reportSum } from "@enough/shared";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadProductReport, loadProducts, type ProductSummary } from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";
import { creditTrendSummary, formatPayment, formatReportUtc } from "./report-presentation";
import { createReportSession, type ReportContext, sameReportContext } from "./report-session";

type ReportRange = 7 | 30 | 90;

function durationLabel(seconds: number): string {
  if (seconds <= 0) return "0m";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function ReportsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [rangeDays, setRangeDays] = useState<ReportRange>(30);
  const [selectedDay, setSelectedDay] = useState("");
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [session] = useState(() =>
    createReportSession({
      request: ({ productId, days }) => loadProductReport(productId, days),
      unauthorized: () => window.location.replace("/login"),
    }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const context: ReportContext = { productId, days: rangeDays };
  const current = sameReportContext(state.context, context);
  const report = current ? state.report : null;
  const loading = productsLoading || (!!productId && (!current || state.loading));
  const error = productsError || (current ? state.error : "");
  function changeContext(next: ReportContext) {
    session.select(next);
    setProductId(next.productId);
    setRangeDays(next.days);
  }

  useEffect(() => {
    let active = true;
    void loadProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
        const requested = new URLSearchParams(window.location.search).get("productId");
        setProductId(items.find((item) => item.id === requested)?.id ?? items[0]?.id ?? "");
        setProductsLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else setProductsError("Products could not be loaded.");
        setProductsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (productId) void session.request({ productId, days: rangeDays });
    return () => session.dispose();
  }, [productId, rangeDays, session]);

  const selected =
    report?.days.find((day) => day.day === selectedDay) ?? report?.days.at(-1) ?? null;
  const trendDays = useMemo(() => report?.days.slice(-14) ?? [], [report]);
  const maxFocusSeconds = Math.max(
    1,
    ...trendDays.map((day) => day.buildSeconds + day.growSeconds),
  );
  const maxSignals = Math.max(1, ...trendDays.map((day) => day.marketSignals));
  const maxCredits = Math.max(
    1,
    ...trendDays.map((day) => Math.max(day.credits.earned, day.credits.spent)),
  );
  const weekly = report?.weeklyReview;
  const creditTrend = creditTrendSummary(trendDays);

  return (
    <WorkspaceFrame
      active="reports"
      eyebrow="Reports"
      title="See the work and signals together"
      description="Review reported Build/Grow focus time, authenticated source events, product-wallet activity, conversion event ratios, and stage history. These records help with reflection; they do not independently verify customer outcomes."
    >
      {products.length > 0 ? (
        <div className="product-toolbar report-toolbar">
          <label className="product-select">
            Product
            <select
              value={productId}
              onChange={(event) => changeContext({ ...context, productId: event.target.value })}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="product-select">
            Trend range
            <select
              value={rangeDays}
              onChange={(event) =>
                changeContext({ ...context, days: Number(event.target.value) as ReportRange })
              }
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
        </div>
      ) : null}
      {loading ? (
        <p className="notice" role="status">
          Loading report…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Report unavailable</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/login">
            Sign in again
          </a>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No product data</p>
          <h2>Reports start with a product workspace</h2>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}

      {report ? (
        <>
          <section className="dashboard-stats report-summary" aria-label="Current product snapshot">
            <article>
              <span>Current stage</span>
              <strong>{report.product.productStageLabel}</strong>
            </article>
            <article>
              <span>Current users</span>
              <strong>{report.product.userCount.toLocaleString()}</strong>
            </article>
            <article>
              <span>Paying users</span>
              <strong>{report.product.payingUserCount.toLocaleString()}</strong>
            </article>
            <article>
              <span>Current revenue snapshot</span>
              <strong>
                {report.product.currentRevenue === null
                  ? "Not recorded"
                  : `${report.product.currentRevenue} ${report.product.revenueCurrency}`}
              </strong>
            </article>
          </section>
          <p className="dashboard-note">
            Current totals are the product values maintained in the workspace. Daily event, wallet,
            and focus reports use UTC dates for {report.period.startDate} through{" "}
            {report.period.endDate}.
          </p>

          {weekly ? (
            <section className="account-card founder-review">
              <p className="eyebrow">Weekly founder review · last 7 UTC days</p>
              <h2>Build / Grow focus split</h2>
              {weekly.buildShare === null ? (
                <p className="muted-copy">
                  No completed focus-session durations were recorded for this week.
                </p>
              ) : (
                <>
                  <div className="ratio-block report-ratio">
                    <div className="ratio-labels">
                      <span>Build · {weekly.buildShare}%</span>
                      <span>Grow · {weekly.growShare}%</span>
                    </div>
                    <div className="ratio-bar">
                      <i style={{ width: `${weekly.buildShare}%` }} />
                      <i style={{ width: `${weekly.growShare}%` }} />
                    </div>
                  </div>
                  <p className="muted-copy">
                    Stage guidance: {report.stageGuidance.buildPercent}% Build /{" "}
                    {report.stageGuidance.marketPercent}% customer learning. This is a planning
                    reference.
                  </p>
                </>
              )}
              <div className="dashboard-stats founder-review-stats">
                <article>
                  <span>Recorded market signals</span>
                  <strong>{weekly.marketSignals}</strong>
                </article>
                <article>
                  <span>Tasks completed</span>
                  <strong>{weekly.tasksCompleted}</strong>
                </article>
                <article>
                  <span>Completions verified (owner/automatic)</span>
                  <strong>{weekly.tasksVerified}</strong>
                </article>
                <article>
                  <span>Awaiting evidence/review</span>
                  <strong>{weekly.tasksAwaitingReview}</strong>
                </article>
                <article>
                  <span>Credits earned</span>
                  <strong>{weekly.creditsEarned}</strong>
                </article>
                <article>
                  <span>Credits spent</span>
                  <strong>{weekly.creditsSpent}</strong>
                </article>
              </div>
              {weekly.highestSignalTask ? (
                <p className="coach-highlight">
                  <strong>Highest signal-rated completed task</strong>
                  <span>
                    {weekly.highestSignalTask.title} · configured signal strength{" "}
                    {weekly.highestSignalTask.signalStrength}/5
                  </span>
                </p>
              ) : null}
              <div className="coach-highlight">
                <strong>Suggested review prompt</strong>
                <span>{weekly.recommendation}</span>
              </div>
            </section>
          ) : null}

          <section className="account-card">
            <p className="eyebrow">Daily report · UTC</p>
            <h2>Choose a day</h2>
            <label className="report-day-select">
              Report date
              <select
                value={selected?.day ?? ""}
                onChange={(event) => setSelectedDay(event.target.value)}
              >
                {report.days
                  .slice()
                  .reverse()
                  .map((day) => (
                    <option key={day.day} value={day.day}>
                      {day.day}
                    </option>
                  ))}
              </select>
            </label>
            {selected ? (
              <>
                <div className="dashboard-stats report-daily-stats">
                  <article>
                    <span>Build focus reported</span>
                    <strong>{durationLabel(selected.buildSeconds)}</strong>
                  </article>
                  <article>
                    <span>Grow focus reported</span>
                    <strong>{durationLabel(selected.growSeconds)}</strong>
                  </article>
                  <article>
                    <span>Market signals</span>
                    <strong>{selected.marketSignals}</strong>
                  </article>
                  <article>
                    <span>Activity events</span>
                    <strong>{selected.activityEvents}</strong>
                  </article>
                </div>
                <ul className="report-detail-list">
                  <li>
                    <span>Outreach event records</span>
                    <strong>{selected.signals.outreach}</strong>
                  </li>
                  <li>
                    <span>Replies received</span>
                    <strong>{selected.signals.replies}</strong>
                  </li>
                  <li>
                    <span>Conversation event records</span>
                    <strong>
                      {reportSum([
                        selected.signals.interviews,
                        selected.signals.feedbackCalls,
                        selected.signals.salesCalls,
                        selected.signals.onboardingCalls,
                        selected.signals.retentionCalls,
                      ])}
                    </strong>
                  </li>
                  <li>
                    <span>Demos completed</span>
                    <strong>{selected.signals.demos}</strong>
                  </li>
                  <li>
                    <span>Signup / activation / retention records</span>
                    <strong>
                      {selected.signals.signups} / {selected.signals.activations} /{" "}
                      {selected.signals.retained}
                    </strong>
                  </li>
                  <li>
                    <span>Task completions</span>
                    <strong>
                      {`${selected.tasksCompleted} completed · ${selected.tasksVerified} verified (owner/automatic)`}
                    </strong>
                  </li>
                  <li>
                    <span>Payment events</span>
                    <strong>{selected.signals.payments}</strong>
                  </li>
                  <li>
                    <span>Payment event amounts</span>
                    <strong>
                      {selected.payments.length
                        ? selected.payments
                            .map(
                              (payment) =>
                                `${formatPayment(payment.amountMinor, payment.currency)} (${payment.paymentCount})`,
                            )
                            .join(" · ")
                        : "No amounts recorded"}
                    </strong>
                  </li>
                  <li>
                    <span>Credits earned / spent</span>
                    <strong>
                      {selected.credits.earned} / {selected.credits.spent}
                    </strong>
                  </li>
                </ul>
              </>
            ) : (
              <p className="muted-copy">No daily data is available for this date.</p>
            )}
          </section>

          <section className="account-card">
            <p className="eyebrow">Build / Grow trend · last {trendDays.length} days</p>
            <h2>Reported focus duration by day</h2>
            {trendDays.some((day) => day.buildSeconds + day.growSeconds > 0) ? (
              <>
                <div className="report-chart-legend">
                  <span>
                    <i className="legend-build" /> Build
                  </span>
                  <span>
                    <i className="legend-grow" /> Grow
                  </span>
                </div>
                <div className="report-chart-scroll">
                  <div
                    className="report-time-chart"
                    role="img"
                    aria-label={trendDays
                      .map(
                        (day) =>
                          `${day.day}: Build ${durationLabel(day.buildSeconds)}, Grow ${durationLabel(day.growSeconds)}`,
                      )
                      .join("; ")}
                  >
                    {trendDays.map((day) => (
                      <div className="report-chart-column" key={day.day}>
                        <strong>{durationLabel(day.buildSeconds + day.growSeconds)}</strong>
                        <div className="report-time-track">
                          <i
                            className="report-build-segment"
                            style={{ height: `${(day.buildSeconds / maxFocusSeconds) * 100}%` }}
                          />
                          <i
                            className="report-grow-segment"
                            style={{ height: `${(day.growSeconds / maxFocusSeconds) * 100}%` }}
                          />
                        </div>
                        <span>{day.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="muted-copy">
                No completed focus-session durations were recorded in this range.
              </p>
            )}
            <p className="report-footnote">
              Durations come from reported focus.session_ended events. Active sessions and time not
              reported by a client are omitted.
            </p>
          </section>

          <section className="account-card">
            <p className="eyebrow">Signal trend · last {trendDays.length} days</p>
            <h2>Authenticated market-signal event count</h2>
            {trendDays.some((day) => day.marketSignals > 0) ? (
              <div className="report-chart-scroll">
                <div
                  className="report-signal-chart"
                  role="img"
                  aria-label={trendDays
                    .map((day) => `${day.day}: ${day.marketSignals} market signal events`)
                    .join("; ")}
                >
                  {trendDays.map((day) => (
                    <div className="report-chart-column" key={day.day}>
                      <strong>{day.marketSignals}</strong>
                      <div className="report-signal-track">
                        <i style={{ height: `${(day.marketSignals / maxSignals) * 100}%` }} />
                      </div>
                      <span>{day.day.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted-copy">
                No recognized market-signal events were recorded in this range.
              </p>
            )}
            <p className="report-footnote">
              Counts include replies, completed conversations and demos, signups, activations,
              retention, and payment events. Outreach attempts are shown in the daily detail but are
              not counted in this signal total. These are normalized records, not necessarily unique
              people or customers; analytics daily records may represent provider reporting-day
              buckets.
            </p>
          </section>

          <section className="account-card">
            <p className="eyebrow">Credit trend · last {trendDays.length} days</p>
            <h2>Product-wallet credits earned and spent</h2>
            {creditTrend.hasActivity ? (
              <>
                <div className="report-chart-legend">
                  <span>
                    <i className="legend-earned" /> Earned
                  </span>
                  <span>
                    <i className="legend-spent" /> Spent
                  </span>
                </div>
                <div className="report-chart-scroll">
                  <div
                    className="report-credit-chart"
                    role="img"
                    aria-label={trendDays
                      .map(
                        (day) =>
                          `${day.day}: ${day.credits.earned} earned, ${day.credits.spent} spent, ${day.credits.refunded} refunded, ${day.credits.adjusted} net adjustment`,
                      )
                      .join("; ")}
                  >
                    {trendDays.map((day) => (
                      <div className="report-credit-column" key={day.day}>
                        <strong>{Math.max(day.credits.earned, day.credits.spent)}</strong>
                        <div className="report-credit-pair">
                          <i
                            className="report-earned-segment"
                            style={{ height: `${(day.credits.earned / maxCredits) * 100}%` }}
                          />
                          <i
                            className="report-spent-segment"
                            style={{ height: `${(day.credits.spent / maxCredits) * 100}%` }}
                          />
                        </div>
                        <span>{day.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="report-footnote">
                  {`Refunded credits: ${creditTrend.refunded} · Net adjustments: ${creditTrend.adjusted}. `}
                  Bars show earned/spent only; refunds and adjustments are included above. Manual
                  wallet controls are prototype controls.
                </p>
              </>
            ) : (
              <p className="muted-copy">
                No earned, spent, refunded or net-adjustment credit activity was recorded in this
                range.
              </p>
            )}
          </section>

          <section className="account-card">
            <p className="eyebrow">Conversion funnels · {report.period.days}-day range</p>
            <h2>Linked event progression</h2>
            <ul className="report-funnel-list">
              {report.conversionFunnels.map((funnel) => (
                <li key={funnel.key}>
                  <div>
                    <strong>{funnel.label}</strong>
                    <span>
                      {funnel.converted} of {funnel.started} linked participants
                    </span>
                  </div>
                  <strong>
                    {funnel.conversionPercent === null
                      ? "No linked starts"
                      : `${funnel.conversionPercent}%`}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="report-footnote">
              Percentages use the first matching event per anonymous reference within the same
              integration account and selected date range. Events without a matching reference are
              excluded, and these are event ratios rather than independently verified cohort
              conversions.
            </p>
          </section>

          <section className="account-card">
            <p className="eyebrow">Stage progression · account history</p>
            <h2>Product stage changes</h2>
            {report.stageHistory.length ? (
              <ol className="history-list report-stage-history">
                {report.stageHistory.map((change) => (
                  <li key={change.id}>
                    <strong>
                      {change.fromStageLabel
                        ? `${change.fromStageLabel} → ${change.toStageLabel}`
                        : `Started at ${change.toStageLabel}`}
                    </strong>
                    <span>{formatReportUtc(change.changedAt)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted-copy">No stage history is recorded.</p>
            )}
          </section>

          <details className="account-card report-trust-details">
            <summary>How to read this report</summary>
            <ul>
              {report.trustNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p className="dashboard-note">
              Signed-source events are authenticated to the workspace owner's configured source;
              this does not establish that a vendor originated the event. Evidence review and task
              rewards continue to use the existing verification flow.
            </p>
          </details>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
