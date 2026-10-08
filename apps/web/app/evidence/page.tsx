"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  createTaskEvidence,
  decideTaskEvidence,
  deleteTaskEvidence,
  loadProducts,
  loadTaskEvidence,
  type ProductSummary,
  type TaskEvidenceCompletion,
  type TaskEvidenceType,
  type TaskEvidenceWorkspace,
} from "../workspace-data";
import { WorkspaceFrame } from "../workspace-frame";

const evidenceTypeLabels: Record<TaskEvidenceType, string> = {
  SELF_REPORT: "Self-report",
  NOTE: "Note",
  URL: "Link",
  UPLOAD: "File upload",
  SCREENSHOT: "Screenshot",
  INTEGRATION: "Integration reference",
};

function evidenceStatusLabel(status: TaskEvidenceCompletion["verificationStatus"]): string {
  switch (status) {
    case "AWAITING_EVIDENCE":
      return "Evidence needed";
    case "AWAITING_REVIEW":
      return "Ready for review";
    case "VERIFIED":
      return "Verified";
    case "AUTOMATICALLY_VERIFIED":
      return "Verified by integration";
    case "REJECTED":
      return "More evidence needed";
    case "SELF_REPORTED":
      return "Legacy self-reported reward";
  }
}

function encodeFile(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
  });
}

export default function EvidencePage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [workspace, setWorkspace] = useState<TaskEvidenceWorkspace | null>(null);
  const [completionId, setCompletionId] = useState("");
  const [evidenceType, setEvidenceType] = useState<TaskEvidenceType>("SELF_REPORT");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void loadProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
        const requested = new URLSearchParams(window.location.search).get("productId");
        setProductId(items.find((item) => item.id === requested)?.id ?? items[0]?.id ?? "");
        const requestedCompletion = new URLSearchParams(window.location.search).get("completionId");
        setCompletionId(requestedCompletion ?? "");
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
    void loadTaskEvidence(productId)
      .then((result) => {
        if (active) {
          setWorkspace(result);
          const validCompletion = result.completions.find(
            (completion) =>
              completion.id === completionId &&
              !["VERIFIED", "AUTOMATICALLY_VERIFIED", "SELF_REPORTED"].includes(
                completion.verificationStatus,
              ),
          );
          const firstAwaiting = result.completions.find(
            (completion) =>
              !["VERIFIED", "AUTOMATICALLY_VERIFIED", "SELF_REPORTED"].includes(
                completion.verificationStatus,
              ),
          );
          if (!validCompletion) setCompletionId(firstAwaiting?.id ?? "");
        }
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) window.location.replace("/login");
        else if (active)
          setError(cause instanceof Error ? cause.message : "Task evidence could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId, completionId]);

  async function refresh() {
    if (productId) setWorkspace(await loadTaskEvidence(productId));
  }

  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body: Parameters<typeof createTaskEvidence>[0] = {
      completionId,
      evidenceType,
      title: String(values.get("title") ?? "").trim() || undefined,
    };
    const note = String(values.get("note") ?? "").trim();
    if (["SELF_REPORT", "NOTE", "URL", "INTEGRATION"].includes(evidenceType) && note)
      body.note = note;
    if (evidenceType === "URL") body.url = String(values.get("url") ?? "").trim();
    if (evidenceType === "INTEGRATION") {
      body.integrationProvider = String(values.get("integrationProvider") ?? "");
      body.integrationReference = String(values.get("integrationReference") ?? "").trim();
    }
    if (evidenceType === "UPLOAD" || evidenceType === "SCREENSHOT") {
      const file = values.get("file");
      if (!(file instanceof File) || file.size === 0) {
        setError("Choose a file to attach.");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setError("Each upload must be 2 MiB or smaller.");
        return;
      }
      if (
        !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type) ||
        (evidenceType === "SCREENSHOT" && file.type === "application/pdf")
      ) {
        setError("Choose a PNG, JPEG, WebP, or PDF file. Screenshots must be an image.");
        return;
      }
      body.fileName = file.name;
      body.contentType = file.type as "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
      try {
        body.fileContentBase64 = await encodeFile(file);
      } catch {
        setError("The selected file could not be read. Choose it again and retry.");
        return;
      }
      if (note) body.note = note;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createTaskEvidence(body);
      form.reset();
      await refresh();
      setNotice("Evidence saved privately. It is waiting for manual review.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function reviewEvidence(event: FormEvent<HTMLFormElement>, evidenceId: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value as "VERIFIED" | "REJECTED" | undefined;
    if (decision !== "VERIFIED" && decision !== "REJECTED") {
      setError("Choose a review decision.");
      return;
    }
    const reason = String(values.get("reason") ?? "").trim();
    if (decision === "REJECTED" && reason.length < 3) {
      setError("Add a short reason when rejecting evidence.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await decideTaskEvidence(evidenceId, decision, reason || undefined);
      await refresh();
      setNotice(
        result.rewardIssued
          ? "Evidence verified. The task reward was added to the product wallet."
          : decision === "VERIFIED"
            ? "Evidence verified."
            : "Evidence rejected; the contributor can add more evidence.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review decision could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeEvidence(evidenceId: string) {
    if (
      !window.confirm(
        "Delete this evidence and its uploaded file or submitted details? Task review and reward history will remain.",
      )
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteTaskEvidence(evidenceId);
      await refresh();
      setNotice(
        "Evidence details and any uploaded file were deleted. Task and reward history remain.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  const reviewable =
    workspace?.completions.filter(
      (completion) =>
        !["VERIFIED", "AUTOMATICALLY_VERIFIED", "SELF_REPORTED"].includes(
          completion.verificationStatus,
        ),
    ) ?? [];

  return (
    <WorkspaceFrame
      active="evidence"
      eyebrow="Evidence"
      title="Record evidence for completed tasks"
      description="Attach a note, link, file, screenshot, self-report, or integration reference to a completed task. A manual review is required before its credit reward is issued."
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
          Loading evidence…
        </p>
      ) : null}
      {error ? (
        <section className="account-card" role="alert">
          <h2>Evidence action could not be completed</h2>
          <p className="error">{error}</p>
        </section>
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <section className="account-card">
          <p className="eyebrow">No product yet</p>
          <h2>Evidence follows completed product tasks</h2>
          <a className="primary-button link-button" href="/onboarding">
            Start onboarding
          </a>
        </section>
      ) : null}
      {workspace ? (
        <>
          {reviewable.length ? (
            <section className="account-card">
              <p className="eyebrow">Add evidence</p>
              <h2>Support a completed task</h2>
              <form
                className="product-form evidence-form"
                onSubmit={(event) => void addEvidence(event)}
              >
                <label>
                  Completed task
                  <select
                    value={completionId}
                    onChange={(event) => setCompletionId(event.target.value)}
                    required
                  >
                    {reviewable.map((completion) => (
                      <option key={completion.id} value={completion.id}>
                        {completion.taskTitle} · {completion.rewardCredits} credits pending
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Evidence type
                  <select
                    value={evidenceType}
                    onChange={(event) => setEvidenceType(event.target.value as TaskEvidenceType)}
                  >
                    {Object.entries(evidenceTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input name="title" maxLength={160} placeholder="Short description" />
                </label>
                {evidenceType === "SELF_REPORT" || evidenceType === "NOTE" ? (
                  <label>
                    {evidenceType === "SELF_REPORT" ? "What did you do?" : "Evidence note"}
                    <textarea
                      name="note"
                      required
                      minLength={2}
                      maxLength={5000}
                      rows={4}
                      placeholder="Describe the action and what happened."
                    />
                  </label>
                ) : null}
                {evidenceType === "URL" ? (
                  <>
                    <label>
                      HTTP or HTTPS link
                      <input
                        name="url"
                        type="url"
                        required
                        maxLength={2048}
                        placeholder="https://example.com/reference"
                      />
                    </label>
                    <label>
                      Context <span className="muted-copy">(optional)</span>
                      <textarea
                        name="note"
                        maxLength={5000}
                        rows={3}
                        placeholder="What should a reviewer look at?"
                      />
                    </label>
                  </>
                ) : null}
                {evidenceType === "UPLOAD" || evidenceType === "SCREENSHOT" ? (
                  <>
                    <label>
                      {evidenceType === "SCREENSHOT" ? "Screenshot" : "File"}
                      <input
                        name="file"
                        type="file"
                        accept={
                          evidenceType === "SCREENSHOT"
                            ? "image/png,image/jpeg,image/webp"
                            : "image/png,image/jpeg,image/webp,application/pdf"
                        }
                        required
                      />
                    </label>
                    <label>
                      Context <span className="muted-copy">(optional)</span>
                      <textarea
                        name="note"
                        maxLength={5000}
                        rows={3}
                        placeholder="What does this file show?"
                      />
                    </label>
                    <p className="evidence-help">
                      PNG, JPEG, WebP, or PDF · 2 MiB per file · 20 MiB upload storage per account.
                    </p>
                  </>
                ) : null}
                {evidenceType === "INTEGRATION" ? (
                  <>
                    <label>
                      Service
                      <select name="integrationProvider" required>
                        <option value="">Choose a source</option>
                        <option value="gmail">Gmail</option>
                        <option value="google_calendar">Google Calendar</option>
                        <option value="outlook">Outlook</option>
                        <option value="microsoft_calendar">Microsoft Calendar</option>
                        <option value="stripe">Stripe</option>
                        <option value="posthog">PostHog</option>
                        <option value="plausible">Plausible</option>
                        <option value="ga4">Google Analytics 4</option>
                        <option value="webhook">Webhook</option>
                        <option value="public_api">Public API</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Event reference
                      <input
                        name="integrationReference"
                        required
                        minLength={1}
                        maxLength={300}
                        placeholder="Event ID or external reference"
                      />
                    </label>
                    <label>
                      Context <span className="muted-copy">(optional)</span>
                      <textarea
                        name="note"
                        maxLength={5000}
                        rows={3}
                        placeholder="Describe the event. This entry is not connected to that service."
                      />
                    </label>
                    <p className="evidence-help">
                      This is a user-submitted reference. Enough has not authenticated it with the
                      service; verified connectors are planned for Phase 14.
                    </p>
                  </>
                ) : null}
                <button
                  className="primary-button evidence-submit"
                  type="submit"
                  disabled={saving || !completionId}
                >
                  Save evidence
                </button>
              </form>
            </section>
          ) : null}

          <section className="account-card">
            <p className="eyebrow">Manual review</p>
            <h2>Evidence and task history</h2>
            {workspace.completions.length ? (
              <ul className="evidence-list">
                {workspace.completions.map((completion) => (
                  <li key={completion.id}>
                    <div className="evidence-completion-heading">
                      <div>
                        <strong>{completion.taskTitle}</strong>
                        <span>
                          {evidenceStatusLabel(completion.verificationStatus)} ·{" "}
                          {completion.rewardCredits} credits · Completed{" "}
                          {new Date(completion.completedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <a className="quiet-link" href={`/tasks?productId=${completion.productId}`}>
                        Open tasks
                      </a>
                    </div>
                    {completion.reviewedAt ? (
                      <p className="evidence-review-note">
                        Product owner review recorded{" "}
                        {new Date(completion.reviewedAt).toLocaleString()}.
                      </p>
                    ) : null}
                    {completion.reviewNote ? (
                      <p className="evidence-review-note">Review note: {completion.reviewNote}</p>
                    ) : null}
                    {completion.evidence.length ? (
                      <ul className="evidence-items">
                        {completion.evidence.map((item) => (
                          <li key={item.id}>
                            <div className="evidence-item-heading">
                              <div>
                                <strong>{item.title}</strong>
                                <span>
                                  {evidenceTypeLabels[item.evidenceType]} ·{" "}
                                  {item.provenance === "SERVER_VERIFIED"
                                    ? `source signature verified · ${item.verificationStatus.toLocaleLowerCase()}`
                                    : item.verificationStatus
                                        .toLocaleLowerCase()
                                        .replaceAll("_", " ")}{" "}
                                  · {new Date(item.createdAt).toLocaleString()}
                                </span>
                              </div>
                              <div className="goal-actions">
                                {item.fileSize ? (
                                  <span>{(item.fileSize / 1024).toFixed(0)} KiB</span>
                                ) : null}
                                <button
                                  className="danger-button"
                                  type="button"
                                  disabled={saving}
                                  onClick={() => void removeEvidence(item.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            {item.note ? <p className="evidence-body">{item.note}</p> : null}
                            {item.url ? (
                              <p>
                                <a href={item.url} target="_blank" rel="noreferrer nofollow">
                                  Open submitted link
                                </a>
                              </p>
                            ) : null}
                            {item.integrationProvider ? (
                              <p className="evidence-help">
                                {item.integrationProvider} reference: {item.integrationReference} ·
                                User-submitted; service connection not verified
                              </p>
                            ) : null}
                            {item.contentUrl && item.contentType?.startsWith("image/") ? (
                              <img
                                className="evidence-preview"
                                src={item.contentUrl}
                                alt={item.title}
                              />
                            ) : null}
                            {item.contentUrl && item.contentType === "application/pdf" ? (
                              <p>
                                <a href={item.contentUrl}>
                                  Download {item.fileName ?? "evidence file"}
                                </a>
                              </p>
                            ) : null}
                            {item.reviewedAt ? (
                              <p className="evidence-review-note">
                                Decision recorded {new Date(item.reviewedAt).toLocaleString()}.
                              </p>
                            ) : null}
                            {item.reviewNote ? (
                              <p className="evidence-review-note">
                                Decision note: {item.reviewNote}
                              </p>
                            ) : null}
                            {item.verificationStatus === "PENDING" &&
                            completion.verificationStatus !== "SELF_REPORTED" ? (
                              <form
                                className="evidence-review-form"
                                onSubmit={(event) => void reviewEvidence(event, item.id)}
                              >
                                <label>
                                  Reason if rejecting{" "}
                                  <input
                                    name="reason"
                                    maxLength={1000}
                                    placeholder="Required to reject"
                                  />
                                </label>
                                <div className="goal-actions">
                                  <button
                                    type="submit"
                                    name="decision"
                                    value="VERIFIED"
                                    disabled={saving}
                                  >
                                    Verify evidence
                                  </button>
                                  <button
                                    type="submit"
                                    name="decision"
                                    value="REJECTED"
                                    disabled={saving}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </form>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted-copy">
                        No evidence yet. Add a record above after completing a task.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">
                There are no completed tasks to review. Complete an action first, then attach
                evidence here.
              </p>
            )}
          </section>
          <p className="dashboard-note">
            Evidence files are private, size-limited, and included in account export. Manual
            verification is performed by the product owner and recorded in the audit log; it is not
            an independent reviewer or an authenticated service integration.
          </p>
        </>
      ) : null}
    </WorkspaceFrame>
  );
}
