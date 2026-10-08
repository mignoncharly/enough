import { describe, expect, it } from "vitest";
import {
  normalizeToolKey,
  resolveToolClassification,
  type ToolClassificationEntry,
  toolKeyMatches,
} from "./tool-classification.js";

describe("normalizeToolKey", () => {
  it("normalizes application identifiers without accepting empty or control-character values", () => {
    expect(normalizeToolKey("APPLICATION", "  VisualStudioCode.EXE  ")).toBe(
      "visualstudiocode.exe",
    );
    expect(() => normalizeToolKey("APPLICATION", "   ")).toThrow("valid application identifier");
    expect(() => normalizeToolKey("APPLICATION", "app\nname")).toThrow(
      "valid application identifier",
    );
    expect(() => normalizeToolKey("APPLICATION", "a".repeat(254))).toThrow(
      "valid application identifier",
    );
  });

  it("canonicalizes domain URLs, trailing dots, and wildcard domains", () => {
    expect(normalizeToolKey("DOMAIN", " HTTPS://Example.COM.:443/path?q=1 ")).toBe("example.com");
    expect(normalizeToolKey("DOMAIN", "*.Sub.Example.COM")).toBe("*.sub.example.com");
  });

  it.each([
    "https://user:secret@example.com",
    "javascript:alert(1)",
    "-bad.example",
    "example..com",
    "*.",
    "bad\nhost.example",
  ])("rejects unsafe or invalid domain input %s", (value) => {
    expect(() => normalizeToolKey("DOMAIN", value)).toThrow("valid domain name");
  });
});

describe("toolKeyMatches", () => {
  it("matches wildcard domains at any subdomain depth, but not the apex or lookalikes", () => {
    for (const host of ["a.example.com", "a.b.example.com"]) {
      expect(toolKeyMatches("DOMAIN", "*.example.com", host)).toBe(true);
    }
    for (const host of ["example.com", "notexample.com", "example.com.evil.test"]) {
      expect(toolKeyMatches("DOMAIN", "*.example.com", host)).toBe(false);
    }
  });

  it("does not apply domain wildcard matching to application identifiers", () => {
    expect(toolKeyMatches("APPLICATION", "*.example.com", "a.example.com")).toBe(false);
  });
});

describe("resolveToolClassification", () => {
  const input = { toolKind: "DOMAIN" as const, toolKey: "app.example.com", productId: "p1" };
  const entry = (overrides: Partial<ToolClassificationEntry>): ToolClassificationEntry => ({
    toolKind: "DOMAIN",
    toolKey: "*.example.com",
    displayName: "Example",
    classification: "NEUTRAL",
    ...overrides,
  });

  it("uses product mapping before account mapping and catalog", () => {
    const result = resolveToolClassification(
      input,
      [
        entry({ classification: "GROWTH", productId: null }),
        entry({ classification: "BUILD", productId: "p1" }),
      ],
      [entry({ classification: "BLOCKED" })],
    );
    expect(result).toMatchObject({ classification: "BUILD", source: "PRODUCT_MAPPING" });
  });

  it("prefers an exact key over a wildcard at the same mapping scope", () => {
    const result = resolveToolClassification(
      input,
      [
        entry({ toolKey: "*.example.com", classification: "GROWTH" }),
        entry({ toolKey: "app.example.com", classification: "BUILD" }),
      ],
      [],
    );
    expect(result).toMatchObject({ classification: "BUILD", matchedKey: "app.example.com" });
  });

  it("prefers a matching context and excludes mappings for another product", () => {
    const result = resolveToolClassification(
      { ...input, contextKey: "workspace", contextValue: "client-project" },
      [
        entry({ classification: "BLOCKED", productId: "p2" }),
        entry({
          classification: "GROWTH",
          contextKey: "workspace",
          contextValue: "client-project",
        }),
        entry({ classification: "BUILD" }),
      ],
      [],
    );
    expect(result).toMatchObject({ classification: "GROWTH", contextMatched: true });
  });

  it("returns a neutral fallback when nothing matches", () => {
    expect(resolveToolClassification(input, [], [])).toMatchObject({
      classification: "NEUTRAL",
      source: "FALLBACK",
      matchedKey: null,
    });
  });

  it("is deterministic for every ordering of an equivalent candidate set", () => {
    const candidates: [ToolClassificationEntry, ToolClassificationEntry, ToolClassificationEntry] =
      [
        entry({ toolKey: "*.example.com", classification: "GROWTH" }),
        entry({ toolKey: "app.example.com", classification: "BUILD" }),
        entry({ toolKey: "*.example.com", classification: "BLOCKED", productId: "p1" }),
      ];
    const [wildcard, exact, productSpecific] = candidates;
    const expected = resolveToolClassification(input, candidates, []).classification;
    for (const ordered of [
      candidates,
      [...candidates].reverse(),
      [exact, productSpecific, wildcard],
    ]) {
      expect(resolveToolClassification(input, ordered, []).classification).toBe(expected);
    }
  });
});
