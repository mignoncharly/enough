"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  completeGrowthTask,
  createGrowthTask,
  type GrowthTask,
  type GrowthTaskTemplate,
  type GrowthTaskWorkspace,
  loadGrowthTasks,
  loadProducts,
  type ProductSummary,
  updateGrowthTask,
} from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";

function signalLabel(value: number): string {
  if (value >= 5) return "Very strong";
  if (value === 4) return "Strong";
  if (value === 3) return "Moderate";
  if (value === 2) return "Weak";
  return "Very weak";
}

function dueLabel(value: string | null): string {
  if (!value) return "No due date";
  return `Due ${new Date(value).toLocaleDateString()}`;
}

export default function TasksPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [workspace, setWorkspace] = useState<GrowthTaskWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [evidenceCompletionId, setEvidenceCompletionId] = useState("");

  useEffect(() => {
    let active = true;
    void loadProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
        const requested = new URLSearchParams(window.location.search).get("productId");
        setProductId(items.find((item) => item.id === requested)?.id ?? items[0]?.id ?? "");
        setLoading(false);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Products could not be loaded.");
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!productId) {
      setWorkspace(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void loadGrowthTasks(productId)
      .then((result) => {
        if (active) setWorkspace(result);
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Growth tasks could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  async function refresh() {
    if (productId) setWorkspace(await loadGrowthTasks(productId));
  }

  async function addTemplate(template: GrowthTaskTemplate) {
    setSaving(true);
    setError("");
    setNotice("");
    setEvidenceCompletionId("");
    try {
      await createGrowthTask({ productId, templateId: template.id });
      await refresh();
      setNotice("Stage recommendation added to your task list.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recommendation could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function addCustomTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const dueDate = String(values.get("dueAt") ?? "");
    const recurrence = String(values.get("recurrenceDays") ?? "");
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createGrowthTask({
        productId,
        title: String(values.get("title") ?? "").trim(),
        description: String(values.get("description") ?? "").trim() || null,
        priority: Number(values.get("priority")),
        signalStrength: Number(values.get("signalStrength")),
        estimatedMinutes: Number(values.get("estimatedMinutes")),
        rewardCredits: Number(values.get("rewardCredits")),
        recurrenceDays: recurrence ? Number(recurrence) : null,
        dueAt: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
      });
      form.reset();
      await refresh();
      setNotice("Task added.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function finishTask(task: GrowthTask) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await completeGrowthTask(task.id);
      await refresh();
      setEvidenceCompletionId(result.completion?.id ?? "");
      setNotice(
        result.completion?.rewardCredits
          ? "Task marked complete. Add evidence before the reward can be reviewed."
          : "Task marked complete. Add evidence if you want it reviewed.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelTask(task: GrowthTask) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateGrowthTask(task.id, "CANCELLED");
      await refresh();
      setNotice("Task cancelled.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not be cancelled.");
    } finally {
      setSaving(false);
    }
  }

  const activeTasks = workspace?.tasks.filter((task) => task.status === "ACTIVE") ?? [];
  const history = workspace?.tasks.filter((task) => task.status !== "ACTIVE") ?? [];

  return (
    <WorkspaceFrame
      active="tasks"
      eyebrow="Tasks"
      title="Turn focus into next actions"
      description="Create a small, specific action from your current product stage. Set its priority, signal relevance, time estimate, and optional recurrence."
    >
      {products.length > 1 ? (
        <div className="product-toolbar">
          <label className="product-select">
            Product
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {loading ? (
        <p className="notice" role="status">
          Loading growth tasks…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Growth tasks could not be loaded</h2>
          <p className="error">{error}</p>
          <a className="secondary-button link-button" href="/login">
            Sign in again
          </a>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No product yet</p>
          <h2>Set up a workspace to create actions</h2>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}
      {workspace ? (
        <>
          <section className="account-card">
            <p className="eyebrow">Stage recommendations · {workspace.productStageLabel}</p>
            <h2>Choose one useful next step</h2>
            <p className="muted-copy">
              Recommendations are tailored to the selected product stage. You can adjust the task
              details after creating it.
            </p>
            <ul className="task-suggestion-list">
              {workspace.templates.map((template) => {
                const alreadyActive = activeTasks.some((task) => task.templateId === template.id);
                return (
                  <li key={template.id}>
                    <div className="task-suggestion-copy">
                      <strong>{template.title}</strong>
                      <span>
                        Priority {template.priority} · {template.estimatedMinutes} min ·{" "}
                        {template.rewardCredits} credits
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={saving || alreadyActive}
                      onClick={() => void addTemplate(template)}
                    >
                      {alreadyActive ? "Active" : "Add task"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="account-card">
            <p className="eyebrow">Custom task</p>
            <h2>Make the next step yours</h2>
            <form
              className="product-form task-form"
              onSubmit={(event) => void addCustomTask(event)}
            >
              <label>
                Task
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={250}
                  placeholder="Ask three likely customers about their current workaround"
                />
              </label>
              <label>
                Notes <span className="muted-copy">(optional)</span>
                <textarea
                  name="description"
                  maxLength={1000}
                  rows={2}
                  placeholder="What will you learn or deliver?"
                />
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="3">
                  <option value="5">5 · Highest</option>
                  <option value="4">4 · High</option>
                  <option value="3">3 · Normal</option>
                  <option value="2">2 · Low</option>
                  <option value="1">1 · Lowest</option>
                </select>
              </label>
              <label>
                Signal strength
                <select name="signalStrength" defaultValue="3">
                  <option value="5">5 · Very strong</option>
                  <option value="4">4 · Strong</option>
                  <option value="3">3 · Moderate</option>
                  <option value="2">2 · Weak</option>
                  <option value="1">1 · Very weak</option>
                </select>
              </label>
              <label>
                Estimated minutes
                <input
                  name="estimatedMinutes"
                  type="number"
                  min="5"
                  max="600"
                  defaultValue="30"
                  required
                />
              </label>
              <label>
                Credit reward
                <input
                  name="rewardCredits"
                  type="number"
                  min="0"
                  max="10000"
                  defaultValue="0"
                  required
                />
              </label>
              <label>
                Repeat every <span className="muted-copy">(optional)</span>
                <input
                  name="recurrenceDays"
                  type="number"
                  min="1"
                  max="365"
                  placeholder="Days between tasks"
                />
              </label>
              <label>
                Due date <span className="muted-copy">(optional)</span>
                <input name="dueAt" type="date" />
              </label>
              <button className="primary-button task-submit" type="submit" disabled={saving}>
                Add custom task
              </button>
            </form>
          </section>

          <section className="account-card">
            <p className="eyebrow">Your task list</p>
            <h2>{activeTasks.length} active</h2>
            {notice ? (
              <p className="notice" role="status">
                {notice}
                {evidenceCompletionId ? (
                  <>
                    {" "}
                    <a
                      href={`/evidence?productId=${productId}&completionId=${evidenceCompletionId}`}
                    >
                      Add evidence
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            {activeTasks.length ? (
              <ul className="goal-list growth-task-list">
                {activeTasks.map((task) => (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>
                        Priority {task.priority} · Signal {signalLabel(task.signalStrength)} ·{" "}
                        {task.estimatedMinutes} min · {dueLabel(task.dueAt)}
                        {task.recurrenceDays ? ` · Repeats every ${task.recurrenceDays} days` : ""}
                        {task.rewardCredits ? ` · ${task.rewardCredits} credits` : ""}
                      </span>
                    </div>
                    <div className="goal-actions">
                      <button type="button" disabled={saving} onClick={() => void finishTask(task)}>
                        Complete
                      </button>
                      <button type="button" disabled={saving} onClick={() => void cancelTask(task)}>
                        Cancel
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">
                No active tasks. Add a stage recommendation or make a custom task above.
              </p>
            )}
          </section>

          {history.length ? (
            <section className="account-card">
              <p className="eyebrow">Task history</p>
              <h2>Completed and cancelled</h2>
              <ul className="goal-list growth-task-list">
                {history.slice(0, 40).map((task) => (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>
                        {task.status.toLocaleLowerCase()} ·{" "}
                        {task.completedAt
                          ? new Date(task.completedAt).toLocaleString()
                          : "Not completed"}
                        {task.verificationStatus
                          ? ` · ${task.verificationStatus.toLocaleLowerCase().replaceAll("_", " ")}`
                          : ""}
                      </span>
                    </div>
                    <div>
                      <span>
                        {task.rewardCredits ? `${task.rewardCredits} credits` : "No reward"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="dashboard-note">
            Task rewards now require submitted evidence and manual review. Evidence files and
            completion records are private to this product workspace.
          </p>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
