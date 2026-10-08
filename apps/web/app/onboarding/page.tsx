"use client";

import { useEffect, useState } from "react";
import {
  loadOnboarding,
  type OnboardingAnswers,
  type OnboardingResult,
  type ProductStage,
  productStageLabels,
  productStages,
  saveOnboarding,
} from "../workspace-data";
import { ThemePreference } from "../workspace-header";

const blankAnswers: OnboardingAnswers = {
  productDescription: "",
  targetCustomer: "",
  problemStatement: "",
  productStage: "IDEA",
  hasLaunched: false,
  userCount: 0,
  payingUserCount: 0,
  currentRevenue: null,
  revenueCurrency: "EUR",
  nextGoal: "",
  buildTools: [],
};

export default function OnboardingPage() {
  const [answers, setAnswers] = useState<OnboardingAnswers>(blankAnswers);
  const [toolsText, setToolsText] = useState("");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void loadOnboarding()
      .then((result: OnboardingResult) => {
        if (!active) return;
        if (result.answers) {
          setAnswers(result.answers);
          setToolsText(result.answers.buildTools.join(", "));
        }
      })
      .catch((cause: unknown) => {
        const status = (cause as { status?: number })?.status;
        if (status === 401) {
          window.location.replace("/login");
          return;
        }
        if (active)
          setError(cause instanceof Error ? cause.message : "Your workspace could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step < 2) {
      setStep((current) => current + 1);
      return;
    }
    const buildTools = toolsText
      .split(/[\n,]/)
      .map((tool) => tool.trim())
      .filter(Boolean);
    if (buildTools.length > 20) {
      setError("Add up to 20 tools.");
      return;
    }
    if (answers.payingUserCount > answers.userCount) {
      setError("Paying users cannot exceed total users.");
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      const result = await saveOnboarding({
        ...answers,
        buildTools,
        currentRevenue: answers.currentRevenue?.trim() || null,
      });
      if (!result.completed)
        throw new Error("Your answers were saved, but the workspace could not be prepared.");
      window.location.replace("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your answers could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="message-shell">
        <section className="auth-card">
          <p className="notice">Loading your workspace…</p>
        </section>
      </main>
    );

  return (
    <main className="auth-shell">
      <header className="brand-row">
        <a className="brand-mark" href="/" aria-label="Enough home">
          E
        </a>
        <span>Enough</span>
        <a className="quiet-button workspace-header-link" href="/">
          Account
        </a>
        <ThemePreference />
      </header>
      <section className="wizard-wrap">
        <div className="wizard-intro">
          <p className="eyebrow">Your starting point</p>
          <h1>Tell us about what you’re building.</h1>
          <p>We’ll use your answers to recommend a first focus for your product stage.</p>
        </div>
        <section className="wizard-card">
          <div className="wizard-progress">
            <span>Step {step + 1} of 3</span>
            <div>
              <i style={{ width: `${((step + 1) / 3) * 100}%` }} />
            </div>
          </div>
          <form className="wizard-form" onSubmit={submit}>
            {step === 0 ? (
              <>
                <h2>Product and stage</h2>
                <label>
                  What are you building?
                  <textarea
                    required
                    minLength={3}
                    maxLength={240}
                    rows={2}
                    value={answers.productDescription}
                    onChange={(event) => update("productDescription", event.target.value)}
                    placeholder="A scheduling tool for independent clinics"
                  />
                </label>
                <label>
                  Who is it for?
                  <input
                    required
                    minLength={2}
                    maxLength={240}
                    value={answers.targetCustomer}
                    onChange={(event) => update("targetCustomer", event.target.value)}
                    placeholder="Independent physical therapy clinics"
                  />
                </label>
                <label>
                  What problem does it solve?
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    value={answers.problemStatement}
                    onChange={(event) => update("problemStatement", event.target.value)}
                    placeholder="Patients miss appointments and staff spend hours following up"
                  />
                </label>
                <label>
                  What stage are you at?
                  <select
                    value={answers.productStage}
                    onChange={(event) => update("productStage", event.target.value as ProductStage)}
                  >
                    {productStages.map((stage) => (
                      <option key={stage} value={stage}>
                        {productStageLabels[stage]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={answers.hasLaunched}
                    onChange={(event) => update("hasLaunched", event.target.checked)}
                  />
                  Have you launched?
                </label>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <h2>Current traction</h2>
                <p className="wizard-hint">
                  Estimates are fine. Enter zero if you do not have users or revenue yet.
                </p>
                <div className="wizard-grid">
                  <label>
                    How many users?
                    <input
                      type="number"
                      required
                      min={0}
                      step={1}
                      value={answers.userCount}
                      onChange={(event) => update("userCount", Number(event.target.value))}
                    />
                  </label>
                  <label>
                    How many paying users?
                    <input
                      type="number"
                      required
                      min={0}
                      step={1}
                      value={answers.payingUserCount}
                      onChange={(event) => update("payingUserCount", Number(event.target.value))}
                    />
                  </label>
                </div>
                <label>
                  Current revenue
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={answers.currentRevenue ?? ""}
                    onChange={(event) => update("currentRevenue", event.target.value || null)}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Revenue currency
                  <select
                    value={answers.revenueCurrency}
                    onChange={(event) => update("revenueCurrency", event.target.value)}
                  >
                    <option value="EUR">EUR · Euro</option>
                    <option value="USD">USD · US dollar</option>
                    <option value="GBP">GBP · Pound sterling</option>
                    <option value="CAD">CAD · Canadian dollar</option>
                    <option value="AUD">AUD · Australian dollar</option>
                  </select>
                </label>
              </>
            ) : null}
            {step === 2 ? (
              <>
                <h2>Your next focus</h2>
                <label>
                  What is your next goal?
                  <textarea
                    required
                    minLength={2}
                    maxLength={250}
                    rows={3}
                    value={answers.nextGoal}
                    onChange={(event) => update("nextGoal", event.target.value)}
                    placeholder="Get five clinic owners to try the prototype"
                  />
                </label>
                <label>
                  Which tools do you use to build?
                  <textarea
                    rows={3}
                    maxLength={1600}
                    value={toolsText}
                    onChange={(event) => setToolsText(event.target.value)}
                    placeholder="Separate tools with commas, for example: VS Code, Cursor, Terminal"
                  />
                  <small>Optional. Separate tools with commas or new lines; up to 20.</small>
                </label>
                <div className="answer-summary">
                  <strong>Starting stage</strong>
                  <span>{productStageLabels[answers.productStage]}</span>
                  <strong>Next goal</strong>
                  <span>{answers.nextGoal || "Add your next goal above"}</span>
                </div>
              </>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="wizard-actions">
              {step > 0 ? (
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => {
                    setStep((current) => current - 1);
                    setError("");
                  }}
                >
                  Back
                </button>
              ) : (
                <span />
              )}
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Saving…" : step === 2 ? "Prepare my workspace" : "Continue"}
              </button>
            </div>
          </form>
        </section>
      </section>
      <footer className="auth-footer">Enough · Build with evidence.</footer>
    </main>
  );
}
