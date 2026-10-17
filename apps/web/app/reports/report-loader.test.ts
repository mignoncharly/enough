import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProductReport } from "../workspace-data";

afterEach(() => vi.unstubAllGlobals());
describe("Reports workspace loader", () => {
  it("requests the selected context with credentials and no caching", async () => {
    const payload = { product: { id: "synthetic-a" }, period: { days: 7 } };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadProductReport("synthetic-a", 7)).toEqual(payload);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/reports?productId=synthetic-a&days=7", {
      credentials: "include",
      cache: "no-store",
    });
  });
  it("retains unauthorized status for the active-request controller", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "Sign in to continue." }), { status: 401 }),
        ),
    );
    await expect(loadProductReport("synthetic-a", 30)).rejects.toMatchObject({ status: 401 });
  });
});
