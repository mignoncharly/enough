import { describe, expect, it, vi } from "vitest";

// Dynamic path keeps this JavaScript-only fixture outside product type declarations.
const modulePath = "./phase15-provider-boundary.mjs";
const { capabilities, createProviderBoundary } = await import(modulePath);
const url = "https://api.openai.com/v1/responses";
function setup(response?: Response) {
  const transport = vi.fn(
    async () =>
      response ??
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: "{}" }],
            },
          ],
        }),
      ),
  );
  const consent = vi.fn(async () => true);
  const persist = vi.fn(async () => {});
  const inspectPrivacy = vi.fn(async () => {});
  const boundary = createProviderBoundary({
    transport,
    consent,
    persist,
    inspectPrivacy,
    key: "synthetic-key",
    model: "synthetic-model",
  });
  const init = (capability: string) => ({
    method: "POST",
    redirect: "error",
    headers: { authorization: "Bearer synthetic-key" },
    body: JSON.stringify({
      model: "synthetic-model",
      store: false,
      input: [{}, { content: [{ text: JSON.stringify({ capability, context: {} }) }] }],
    }),
  });
  return { boundary, transport, consent, persist, inspectPrivacy, init };
}
describe("Phase 15 bounded provider transport", () => {
  it("is disabled without explicit selection", async () => {
    const s = setup();
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).not.toHaveBeenCalled();
  });
  it("permits seven distinct sequential calls and no eighth/repeat", async () => {
    const s = setup();
    for (const capability of capabilities) {
      s.boundary.select(capability);
      await s.boundary.fetch(url, s.init(capability));
      await s.boundary.accepted();
    }
    expect(s.transport).toHaveBeenCalledTimes(7);
    expect(() => s.boundary.select(capabilities[0])).toThrow();
    expect(JSON.stringify(s.boundary.ledger)).not.toMatch(/synthetic-key|context|authorization/i);
  });
  it.each([
    "https://other.example/v1/responses",
    "https://api.openai.com/v1/models",
    "http://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses?x=1",
  ])("blocks unexpected destination %s", async (target) => {
    const s = setup();
    s.boundary.select(capabilities[0]);
    await expect(s.boundary.fetch(target, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).not.toHaveBeenCalled();
  });
  it("denied consent consumes zero calls and stops", async () => {
    const s = setup();
    s.consent.mockResolvedValue(false);
    s.boundary.select(capabilities[0]);
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).not.toHaveBeenCalled();
    expect(s.boundary.ledger).toHaveLength(0);
  });
  it("privacy failure consumes zero calls", async () => {
    const s = setup();
    s.inspectPrivacy.mockRejectedValue(new Error("private"));
    s.boundary.select(capabilities[0]);
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 429, 500])("HTTP %s never retries", async (status) => {
    const s = setup(new Response("private", { status }));
    s.boundary.select(capabilities[0]);
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).toHaveBeenCalledTimes(1);
    expect(() => s.boundary.select(capabilities[1])).toThrow();
  });
  it.each([
    { status: "incomplete" },
    { status: "failed" },
    { status: "completed", output: [] },
    {
      status: "completed",
      output: [
        { type: "message", role: "assistant", status: "completed", content: [{ type: "refusal" }] },
      ],
    },
  ])("rejects unusable contract and stops", async (payload) => {
    const s = setup(new Response(JSON.stringify(payload)));
    s.boundary.select(capabilities[0]);
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).toHaveBeenCalledTimes(1);
    expect(() => s.boundary.select(capabilities[1])).toThrow();
  });
  it("network failure never retries", async () => {
    const s = setup();
    s.transport.mockRejectedValue(new Error("private"));
    s.boundary.select(capabilities[0]);
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    expect(s.transport).toHaveBeenCalledTimes(1);
    expect(() => s.boundary.select(capabilities[1])).toThrow();
  });
  it("concurrent provider submission stops without second transport", async () => {
    const s = setup();
    let release!: () => void;
    s.consent.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    s.boundary.select(capabilities[0]);
    const first = s.boundary.fetch(url, s.init(capabilities[0]));
    await expect(s.boundary.fetch(url, s.init(capabilities[0]))).rejects.toThrow();
    release();
    await expect(first).rejects.toThrow();
    expect(s.transport).not.toHaveBeenCalled();
  });
  it("disable permanently blocks calls", async () => {
    const s = setup();
    s.boundary.disable();
    expect(() => s.boundary.select(capabilities[0])).toThrow();
    expect(s.transport).not.toHaveBeenCalled();
  });
});
