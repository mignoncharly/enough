import { describe, expect, it, vi } from "vitest";
import type { ProductReport } from "../workspace-data";
import { createReportSession, type ReportContext } from "./report-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const a: ReportContext = { productId: "synthetic-a", days: 30 };
// Controller treats reports as opaque; full response shape is tested at the API.
const reportA = { product: { id: a.productId } } as ProductReport;
const reportB = { product: { id: "synthetic-b" } } as ProductReport;
function setup() {
  const deps = {
    request: vi.fn<() => Promise<ProductReport>>().mockResolvedValue(reportA),
    unauthorized: vi.fn(),
  };
  return { deps, session: createReportSession(deps) };
}

describe("Report page request generation", () => {
  it.each([
    ["product", { ...a, productId: "synthetic-b" }],
    ["range", { ...a, days: 7 as const }],
  ])("invalidates completed content synchronously on %s change", async (_label, next) => {
    const { session } = setup();
    await session.request(a);
    expect(session.getSnapshot().report).toBe(reportA);
    session.select(next);
    expect(session.getSnapshot()).toEqual({
      context: next,
      report: null,
      error: "",
      loading: false,
    });
  });

  it.each([
    ["Product A slow, Product B wins", { ...a, productId: "synthetic-b" }],
    ["30 days slow, 7 days wins", { ...a, days: 7 as const }],
  ])("%s", async (_label, next) => {
    const { session, deps } = setup();
    const slow = deferred<ProductReport>();
    deps.request.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(reportB);
    const old = session.request(a);
    session.select(next);
    await session.request(next);
    slow.resolve(reportA);
    await old;
    expect(session.getSnapshot()).toEqual({
      context: next,
      report: reportB,
      loading: false,
      error: "",
    });
  });

  it("ignores an obsolete 401 after a newer request succeeds", async () => {
    const { session, deps } = setup();
    const old = deferred<ProductReport>();
    deps.request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(reportB);
    const pending = session.request(a);
    const next = { ...a, productId: "synthetic-b" };
    session.select(next);
    await session.request(next);
    old.reject({ status: 401 });
    await pending;
    expect(deps.unauthorized).not.toHaveBeenCalled();
    expect(session.getSnapshot().report).toBe(reportB);
  });

  it("ignores a 401 immediately after selection, before the next effect/request", async () => {
    const { session, deps } = setup();
    const old = deferred<ProductReport>();
    deps.request.mockReturnValueOnce(old.promise);
    const pending = session.request(a);
    session.select({ ...a, days: 7 });
    old.reject({ status: 401 });
    await pending;
    expect(deps.unauthorized).not.toHaveBeenCalled();
    expect(session.getSnapshot().report).toBeNull();
  });

  it("only a current 401 redirects, with no old report retained", async () => {
    const { session, deps } = setup();
    await session.request(a);
    deps.request.mockRejectedValueOnce({ status: 401 });
    await session.request(a);
    expect(deps.unauthorized).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({ report: null, loading: false, error: "" });
  });

  it("current failure after earlier success clears old content and hides technical error details", async () => {
    const { session, deps } = setup();
    await session.request(a);
    deps.request.mockRejectedValueOnce(new Error("synthetic internal SQL failure"));
    await session.request(a);
    expect(session.getSnapshot()).toMatchObject({
      report: null,
      loading: false,
      error: "The product report could not be loaded. Try again.",
    });
  });

  it("old error/finally cannot clear the new loading indicator or set its error", async () => {
    const { session, deps } = setup();
    const old = deferred<ProductReport>();
    const recent = deferred<ProductReport>();
    deps.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const first = session.request(a);
    const second = session.request(a);
    old.reject(new Error("old error"));
    await first;
    expect(session.getSnapshot()).toMatchObject({ loading: true, error: "", report: null });
    recent.resolve(reportB);
    await second;
    expect(session.getSnapshot().report).toBe(reportB);
  });

  it("unmount cleanup ignores unauthorized rejection and supports Strict Mode restart", async () => {
    const { session, deps } = setup();
    const old = deferred<ProductReport>();
    deps.request.mockReturnValueOnce(old.promise);
    const pending = session.request(a);
    session.dispose();
    old.reject({ status: 401 });
    await pending;
    expect(deps.unauthorized).not.toHaveBeenCalled();
    // Strict Mode setup after cleanup can start a fresh request on the same store.
    await session.request(a);
    expect(session.getSnapshot().report).toBe(reportA);
  });
});
