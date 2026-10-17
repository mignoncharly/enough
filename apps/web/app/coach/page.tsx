"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  type AiCapability,
  type AiProviderStatus,
  createGrowthTask,
  type GrowthTaskWorkspace,
  loadAiProviderStatus,
  loadGrowthTasks,
  loadProducts,
  loadTaskEvidence,
  type ProductSummary,
  requestAiAdvice,
  type TaskEvidenceItem,
} from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";
import { type CoachContext, coachContextKey, createCoachSession } from "./coach-session";

const capabilityOptions: Array<{ value: AiCapability; label: string; description: string }> = [
  {
    value: "ONBOARDING_ANALYSIS",
    label: "Onboarding analysis",
    description: "Review the current stage, target customer, and problem statement.",
  },
  {
    value: "TASK_GENERATION",
    label: "Generate tasks",
    description: "Suggest small actions that fit this stage and avoid active task titles.",
  },
  {
    value: "SCOPE_CHALLENGE",
    label: "Challenge task scope",
    description: "Question the size of one active task and suggest a smaller first result.",
  },
  {
    value: "WEEKLY_DIAGNOSIS",
    label: "Weekly diagnosis",
    description:
      "Review stage, numeric traction, and the aggregate event count for the last seven days.",
  },
  {
    value: "NEXT_ACTION",
    label: "Choose a next action",
    description: "Pick one stage-aligned action using active goals, tasks, and aggregate activity.",
  },
  {
    value: "OVERBUILDING_EXPLANATION",
    label: "Explain overbuilding risk",
    description:
      "Use the stage ratio as a planning prompt; actual time allocation is not measured.",
  },
  {
    value: "EVIDENCE_CLASSIFICATION",
    label: "Classify evidence topic",
    description: "Suggest what kind of claim selected evidence appears to relate to.",
  },
];

export default function CoachPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [capability, setCapability] = useState<AiCapability>("NEXT_ACTION");
  const [providerStatus, setProviderStatus] = useState<AiProviderStatus | null>(null);
  const [taskWorkspace, setTaskWorkspace] = useState<GrowthTaskWorkspace | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<TaskEvidenceItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const [session] = useState(() =>
    createCoachSession({
      request: requestAiAdvice,
      createTask: createGrowthTask,
      unauthorized: () => window.location.replace("/login"),
    }),
  );
  const coach = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const context: CoachContext = useMemo(
    () => ({
      productId,
      capability,
      ...(capability === "SCOPE_CHALLENGE" ? { taskId: selectedTaskId } : {}),
      ...(capability === "EVIDENCE_CLASSIFICATION" ? { evidenceId: selectedEvidenceId } : {}),
    }),
    [productId, capability, selectedTaskId, selectedEvidenceId],
  );
  const current = coachContextKey(context) === coachContextKey(coach.context);
  const result = current ? coach.result : null;
  const requesting = current && coach.requesting;
  const savingTask = current ? coach.savingTask : "";
  const addedTaskTitles = current ? coach.addedTaskTitles : [];
  const notice = current ? coach.notice : "";
  const refusal = current ? coach.refusal : "";
  function changeContext(next: CoachContext) {
    session.select(next);
  }
  useEffect(() => {
    session.select(context);
  }, [session, context]);
  useEffect(() => () => session.dispose(), [session]);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setError] = useState("");
  const error = contextError || (current ? coach.error : "");

  useEffect(() => {
    let active = true;
    const requestedProduct = new URLSearchParams(window.location.search).get("productId");
    void Promise.all([loadProducts(), loadAiProviderStatus()])
      .then(([items, status]) => {
        if (!active) return;
        setProducts(items);
        setProviderStatus(status);
        setProductId(items.find((item) => item.id === requestedProduct)?.id ?? items[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "The Coach could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setTaskWorkspace(null);
    setEvidenceItems([]);
    setSelectedTaskId("");
    setSelectedEvidenceId("");
    setError("");
    setContextLoading(false);
    if (!productId) return;
    if (capability !== "SCOPE_CHALLENGE" && capability !== "EVIDENCE_CLASSIFICATION") return;

    setContextLoading(true);
    const loadContext =
      capability === "SCOPE_CHALLENGE"
        ? loadGrowthTasks(productId).then((workspace) => {
            if (!active) return;
            setTaskWorkspace(workspace);
            setSelectedTaskId(workspace.tasks.find((task) => task.status === "ACTIVE")?.id ?? "");
          })
        : loadTaskEvidence(productId).then((workspace) => {
            if (!active) return;
            const items = workspace.completions.flatMap((completion) => completion.evidence);
            setEvidenceItems(items);
            setSelectedEvidenceId(items[0]?.id ?? "");
          });
    void loadContext
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "The selected product context could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setContextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId, capability]);

  const selectedCapability = useMemo(
    () => capabilityOptions.find((option) => option.value === capability) ?? capabilityOptions[0],
    [capability],
  );
  const activeTasks = taskWorkspace?.tasks.filter((task) => task.status === "ACTIVE") ?? [];
  const canRequest =
    Boolean(productId) &&
    !requesting &&
    !contextLoading &&
    (!providerStatus?.providerConfigured || providerStatus.providerConsentEnabled) &&
    (capability !== "SCOPE_CHALLENGE" || Boolean(selectedTaskId)) &&
    (capability !== "EVIDENCE_CLASSIFICATION" || Boolean(selectedEvidenceId));

  async function getAdvice() {
    if (!canRequest) return;
    session.select(context);
    await session.request();
  }

  const selectedTask = activeTasks.find((task) => task.id === selectedTaskId);
  const selectedEvidence = evidenceItems.find((item) => item.id === selectedEvidenceId);

  return (
    <WorkspaceFrame
      active="coach"
      eyebrow="AI Coach"
      title="Think through your next move"
      description="Get stage-aware advice, challenge one task, or ask for help classifying an evidence topic. Advice never changes rules, verifies evidence, or awards credits."
    >
      {loading ? (
        <p className="notice" role="status">
          Loading Coach…
        </p>
      ) : null}
      {error && !products.length ? (
        <section className="account-card" role="alert">
          <h2>Coach could not be loaded</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/login">
            Sign in again
          </a>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No product yet</p>
          <h2>Set up a workspace to use the Coach</h2>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}

      {products.length > 0 ? (
        <>
          <section className="account-card">
            <p className="eyebrow">Choose an action</p>
            <div className="product-toolbar coach-toolbar">
              <label className="product-select">
                Product
                <select
                  value={productId}
                  onChange={(event) => {
                    changeContext({ productId: event.target.value, capability });
                    setProductId(event.target.value);
                  }}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="product-select">
                Coaching action
                <select
                  value={capability}
                  onChange={(event) => {
                    changeContext({ productId, capability: event.target.value as AiCapability });
                    setCapability(event.target.value as AiCapability);
                  }}
                >
                  {capabilityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted-copy">{selectedCapability.description}</p>
            {providerStatus?.providerConfigured && !providerStatus.providerConsentEnabled ? (
              <p className="notice">
                OpenAI is configured, but optional provider processing is off. Review the data use
                and grant consent in <a href="/privacy">Privacy</a> to send the selected context
                when you click Get advice.
              </p>
            ) : null}

            {capability === "SCOPE_CHALLENGE" ? (
              <label className="coach-context-select" htmlFor="coach-active-task">
                Active task
                {contextLoading ? (
                  <span className="muted-copy">Loading tasks…</span>
                ) : activeTasks.length ? (
                  <select
                    id="coach-active-task"
                    value={selectedTaskId}
                    onChange={(event) => {
                      changeContext({ ...context, taskId: event.target.value });
                      setSelectedTaskId(event.target.value);
                    }}
                  >
                    {activeTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted-copy">There are no active tasks to challenge.</span>
                )}
              </label>
            ) : null}

            {capability === "EVIDENCE_CLASSIFICATION" ? (
              <label className="coach-context-select" htmlFor="coach-evidence">
                Selected evidence
                {contextLoading ? (
                  <span className="muted-copy">Loading evidence…</span>
                ) : evidenceItems.length ? (
                  <select
                    id="coach-evidence"
                    value={selectedEvidenceId}
                    onChange={(event) => {
                      changeContext({ ...context, evidenceId: event.target.value });
                      setSelectedEvidenceId(event.target.value);
                    }}
                  >
                    {evidenceItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} · {item.evidenceType} · {item.verificationStatus}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted-copy">
                    No evidence records are available for this product.
                  </span>
                )}
              </label>
            ) : null}

            <div className="coach-privacy" role="note">
              <strong>
                {providerStatus?.providerConfigured
                  ? `Requests go to OpenAI${providerStatus.model ? ` (${providerStatus.model})` : ""} when you click Get advice.`
                  : "No OpenAI provider is configured; Get advice uses local stage guidance."}
              </strong>
              <span>
                {capability === "ONBOARDING_ANALYSIS"
                  ? "This action may send the product stage, target customer, problem statement, and active goal titles."
                  : null}
              </span>
              <span>
                {capability === "TASK_GENERATION"
                  ? "This action may send the product stage, target customer, problem statement, active goal titles, and active task titles."
                  : null}
              </span>
              <span>
                {capability === "SCOPE_CHALLENGE"
                  ? `This action may send the selected task title, notes, time estimate, product stage, and active goal titles${selectedTask ? ` (currently selected: ${selectedTask.title})` : ""}.`
                  : null}
              </span>
              <span>
                {capability === "WEEKLY_DIAGNOSIS"
                  ? "This action may send product stage, active goal titles, numeric traction, and a seven-day event count. It does not send individual events or event attributes."
                  : null}
              </span>
              <span>
                {capability === "NEXT_ACTION"
                  ? "This action may send product stage, active goal and task titles, numeric traction, and a seven-day event count. It does not send individual events or event attributes."
                  : null}
              </span>
              <span>
                {capability === "OVERBUILDING_EXPLANATION"
                  ? "This action uses product stage guidance and its suggested build/customer-learning ratio."
                  : null}
              </span>
              <span>
                {capability === "EVIDENCE_CLASSIFICATION"
                  ? `This action may send the selected evidence type, title, and up to 1,500 characters of its note${selectedEvidence ? ` (currently selected: ${selectedEvidence.title})` : ""}. The note is sent as text. Evidence file contents, URL fields, and integration-reference fields are omitted.`
                  : null}
              </span>
              <span>
                Enough does not attach account identifiers, uploaded files, rule data, or session
                credentials to the advice input. User-entered titles and notes are not automatically
                anonymized or scrubbed of secrets; remove sensitive details and send only content
                you have permission to share. Evidence classification is advisory and needs human
                review. See <a href="/privacy">Privacy</a> for OpenAI data handling and consent.
              </span>
            </div>

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            {refusal ? (
              <p className="notice" role="status">
                {refusal}
              </p>
            ) : null}
            {notice ? (
              <p className="notice" role="status">
                {notice}
              </p>
            ) : null}
            {contextLoading &&
            (capability === "SCOPE_CHALLENGE" || capability === "EVIDENCE_CLASSIFICATION") ? (
              <p className="muted-copy" role="status">
                Loading selected context…
              </p>
            ) : null}
            {(capability === "SCOPE_CHALLENGE" && activeTasks.length === 0 && !contextLoading) ||
            (capability === "EVIDENCE_CLASSIFICATION" &&
              evidenceItems.length === 0 &&
              !contextLoading) ? (
              <p className="muted-copy">
                Choose another coaching action or add the required workspace data first.
              </p>
            ) : null}
            <button
              className="primary-button coach-submit"
              type="button"
              disabled={!canRequest}
              onClick={() => void getAdvice()}
            >
              {requesting ? "Thinking…" : "Get advice"}
            </button>
          </section>

          {result ? (
            <section className="account-card coach-result" aria-live="polite">
              <p className="eyebrow">
                {result.source === "OPENAI" ? "OpenAI advice" : "Stage guidance"}
              </p>
              <h2>{result.advice.headline}</h2>
              {result.advice.diagnosis ? <p>{result.advice.diagnosis}</p> : null}
              {result.advice.nextAction ? (
                <div className="coach-highlight">
                  <strong>Next action</strong>
                  <span>{result.advice.nextAction}</span>
                </div>
              ) : null}
              {result.advice.rationale ? (
                <p className="muted-copy">{result.advice.rationale}</p>
              ) : null}
              {result.advice.scopeChallenge ? (
                <div className="coach-highlight">
                  <strong>Scope question</strong>
                  <span>{result.advice.scopeChallenge}</span>
                </div>
              ) : null}
              {result.advice.overbuildingExplanation ? (
                <div className="coach-highlight">
                  <strong>Planning check</strong>
                  <span>{result.advice.overbuildingExplanation}</span>
                </div>
              ) : null}
              {capability === "EVIDENCE_CLASSIFICATION" ? (
                <div className="coach-highlight">
                  <strong>
                    Suggested topic:{" "}
                    {result.advice.evidenceClassification.category.replaceAll("_", " ")} ·{" "}
                    {result.advice.evidenceClassification.confidence.toLocaleLowerCase()} confidence
                  </strong>
                  <span>{result.advice.evidenceClassification.rationale}</span>
                  {result.advice.evidenceClassification.missingInformation.length ? (
                    <ul>
                      {Array.from(
                        new Set(result.advice.evidenceClassification.missingInformation),
                      ).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  <span>
                    This is not an evidence decision. Existing verification and reward rules still
                    require their normal review steps.
                  </span>
                </div>
              ) : null}
              {result.advice.tasks.length ? (
                <>
                  <h3>Suggested tasks</h3>
                  <ul className="task-suggestion-list">
                    {result.advice.tasks.map((task) => {
                      const alreadyAdded = addedTaskTitles.includes(task.title);
                      return (
                        <li key={task.title}>
                          <div className="task-suggestion-copy">
                            <strong>{task.title}</strong>
                            <span>
                              {task.description} · Priority {task.priority} ·{" "}
                              {task.estimatedMinutes} min
                            </span>
                          </div>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={Boolean(savingTask) || alreadyAdded}
                            onClick={() => void session.addTask(task)}
                          >
                            {savingTask === task.title
                              ? "Adding…"
                              : alreadyAdded
                                ? "Added"
                                : "Add task"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              <p className="coach-caveat">{result.advice.caveat}</p>
            </section>
          ) : null}
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
