import { describe, expect, it, vi } from "vitest";
import type { AiCoachResponse, AiCoachResult } from "../workspace-data";
import { type CoachContext, createCoachSession } from "./coach-session";

const task = {
  title: "Ask one tester",
  description: "A synthetic suggestion",
  priority: 3,
  signalStrength: 3,
  estimatedMinutes: 30,
};
const result: AiCoachResult = {
  source: "OPENAI",
  advice: {
    headline: "Small step",
    diagnosis: "",
    nextAction: "",
    rationale: "",
    scopeChallenge: "",
    overbuildingExplanation: "",
    tasks: [task],
    evidenceClassification: {
      category: "UNCLEAR",
      confidence: "LOW",
      rationale: "",
      missingInformation: [],
    },
    caveat: "Advisory",
  },
};
const context: CoachContext = { productId: "synthetic-product-a", capability: "TASK_GENERATION" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const deps = {
    request: vi.fn<() => Promise<AiCoachResponse>>().mockResolvedValue(result),
    createTask: vi.fn().mockResolvedValue({}),
    unauthorized: vi.fn(),
  };
  const session = createCoachSession(deps);
  session.select(context);
  return { session, deps };
}
const switches: Array<[string, CoachContext]> = [
  ["product", { ...context, productId: "synthetic-product-b" }],
  ["capability", { ...context, capability: "NEXT_ACTION" }],
  ["task selection", { ...context, capability: "SCOPE_CHALLENGE", taskId: "synthetic-task" }],
  [
    "evidence selection",
    { ...context, capability: "EVIDENCE_CLASSIFICATION", evidenceId: "synthetic-evidence" },
  ],
];
describe("Coach page request state", () => {
  it.each(switches)("clears completed advice and task state on %s switch", async (_label, next) => {
    const { session, deps } = setup();
    await session.request();
    await session.addTask(task);
    expect(session.getSnapshot().addedTaskTitles).toEqual([task.title]);
    session.select(next);
    expect(session.getSnapshot()).toMatchObject({
      context: next,
      result: null,
      addedTaskTitles: [],
      error: "",
      refusal: "",
      notice: "",
      requesting: false,
    });
    await session.addTask(task);
    expect(deps.createTask).toHaveBeenCalledTimes(1);
  });
  it.each(switches)("ignores in-flight completion on %s switch", async (_label, next) => {
    const { session, deps } = setup();
    const pending = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(pending.promise);
    const request = session.request();
    session.select(next);
    pending.resolve(result);
    await request;
    expect(session.getSnapshot()).toMatchObject({ context: next, result: null, requesting: false });
    await session.addTask(task);
    expect(deps.createTask).not.toHaveBeenCalled();
  });
  it("newest same-context request wins over an older slower completion", async () => {
    const { session, deps } = setup();
    const slow = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(slow.promise);
    const old = session.request();
    await session.request();
    const current = session.getSnapshot().result;
    slow.resolve({ ...result, source: "STAGE_GUIDANCE" });
    await old;
    expect(session.getSnapshot().result).toBe(current);
  });
  it("old error/finally cannot overwrite a newer loading state", async () => {
    const { session, deps } = setup();
    const old = deferred<AiCoachResponse>();
    const recent = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const first = session.request();
    const second = session.request();
    old.reject(new Error("old error"));
    await first;
    expect(session.getSnapshot()).toMatchObject({ error: "", requesting: true });
    recent.resolve(result);
    await second;
    expect(session.getSnapshot().result).toBe(result);
  });
  it("switching away and back cannot resurrect old advice", async () => {
    const { session, deps } = setup();
    const pending = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(pending.promise);
    const request = session.request();
    session.select(switches[0][1]);
    session.select(context);
    pending.resolve(result);
    await request;
    expect(session.getSnapshot().result).toBeNull();
  });
  it("unmount invalidates pending work and a new mount starts empty", async () => {
    const { session, deps } = setup();
    const pending = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(pending.promise);
    const request = session.request();
    session.dispose();
    pending.resolve(result);
    await request;
    expect(session.getSnapshot().result).toBeNull();
    expect(setup().session.getSnapshot().result).toBeNull();
  });
  it("refusal has a distinct state and cannot create tasks", async () => {
    const { session, deps } = setup();
    deps.request.mockResolvedValue({
      source: "OPENAI",
      outcome: "REFUSED",
      message: "Cannot offer advice",
    });
    await session.request();
    expect(session.getSnapshot()).toMatchObject({
      result: null,
      error: "",
      refusal: "Cannot offer advice",
    });
    await session.addTask(task);
    expect(deps.createTask).not.toHaveBeenCalled();
    session.select(switches[0][1]);
    expect(session.getSnapshot().refusal).toBe("");
  });
  it("errors cannot create tasks, and local guidance stays labelled", async () => {
    const { session, deps } = setup();
    deps.request.mockRejectedValueOnce(new Error("Safe failure"));
    await session.request();
    await session.addTask(task);
    expect(deps.createTask).not.toHaveBeenCalled();
    deps.request.mockResolvedValue({ ...result, source: "STAGE_GUIDANCE" });
    await session.request();
    expect(session.getSnapshot().result?.source).toBe("STAGE_GUIDANCE");
    expect(session.getSnapshot().error).toBe("");
  });
  it("current unauthorized advice clears previous advice and requests sign-in without saving", async () => {
    const { session, deps } = setup();
    await session.request();
    deps.request.mockRejectedValueOnce(
      Object.assign(new Error("Sign in required"), { status: 401 }),
    );
    await session.request();
    expect(deps.unauthorized).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({
      result: null,
      error: "Sign in required",
      requesting: false,
    });
    await session.addTask(task);
    expect(deps.createTask).not.toHaveBeenCalled();
  });
  it("an unauthorized response from an old context cannot redirect the current context", async () => {
    const { session, deps } = setup();
    const old = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(old.promise);
    const request = session.request();
    session.select(switches[0][1]);
    old.reject(Object.assign(new Error("Old session error"), { status: 401 }));
    await request;
    expect(deps.unauthorized).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      context: switches[0][1],
      result: null,
      error: "",
      requesting: false,
    });
  });
  it("creates only an explicitly chosen current suggestion with zero reward, once", async () => {
    const { session, deps } = setup();
    await session.request();
    expect(deps.createTask).not.toHaveBeenCalled();
    await session.addTask({ ...task });
    expect(deps.createTask).not.toHaveBeenCalled();
    const pending = deferred<never>();
    deps.createTask.mockReturnValue(pending.promise);
    const save = session.addTask(task);
    await session.addTask(task);
    expect(deps.createTask).toHaveBeenCalledExactlyOnceWith({
      ...task,
      productId: context.productId,
      rewardCredits: 0,
    });
    pending.reject(new Error("ambiguous response"));
    await save;
    await session.addTask(task);
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().notice).toContain("Check Tasks");
  });
  it("task save remains scoped to original product and cannot update switched context", async () => {
    const { session, deps } = setup();
    await session.request();
    const pending = deferred<never>();
    deps.createTask.mockReturnValue(pending.promise);
    const save = session.addTask(task);
    session.select(switches[0][1]);
    pending.reject(new Error("old save error"));
    await save;
    expect(deps.createTask.mock.calls[0][0].productId).toBe(context.productId);
    expect(session.getSnapshot()).toMatchObject({
      error: "",
      notice: "",
      savingTask: "",
      addedTaskTitles: [],
    });
  });
  it("a new advice request invalidates the prior suggestion immediately", async () => {
    const { session, deps } = setup();
    await session.request();
    const pending = deferred<AiCoachResponse>();
    deps.request.mockReturnValueOnce(pending.promise);
    const request = session.request();
    await session.addTask(task);
    expect(deps.createTask).not.toHaveBeenCalled();
    pending.resolve(result);
    await request;
  });
  it("does not create tasks from non-task capabilities even if an invalid response supplies tasks", async () => {
    const { session, deps } = setup();
    session.select({ ...context, capability: "NEXT_ACTION" });
    await session.request();
    await session.addTask(task);
    expect(deps.createTask).not.toHaveBeenCalled();
  });
});
