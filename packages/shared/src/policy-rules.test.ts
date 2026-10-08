import { describe, expect, it } from "vitest";
import {
  evaluatePolicyRules,
  type PolicyEvaluationInput,
  type PolicyOverride,
  type PolicyRule,
} from "./policy-rules.js";

const evaluatedAt = "2026-05-01T12:00:00.000Z";
const input: PolicyEvaluationInput = {
  toolKind: "DOMAIN",
  toolKey: "app.example.com",
  classification: "GROWTH",
  productId: "product-1",
  deviceId: "device-1",
  evaluatedAt,
};

function rule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "rule-1",
    version: 3,
    name: "Example rule",
    enabled: true,
    priority: 10,
    productId: null,
    deviceId: null,
    action: "BLOCK",
    conditions: {},
    schedule: null,
    ...overrides,
  };
}

function override(overrides: Partial<PolicyOverride> = {}): PolicyOverride {
  return {
    id: "override-1",
    productId: null,
    deviceId: null,
    toolKind: "DOMAIN",
    toolKey: "*.example.com",
    action: "ALLOW",
    reason: "User override",
    startsAt: "2026-05-01T11:00:00.000Z",
    expiresAt: "2026-05-01T13:00:00.000Z",
    createdAt: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("evaluatePolicyRules defaults and matching", () => {
  it("allows by default and normalizes the evaluation timestamp", () => {
    expect(evaluatePolicyRules(input, [], [])).toMatchObject({
      action: "ALLOW",
      allowed: true,
      source: "DEFAULT",
      evaluatedAt,
      matchedRuleId: null,
    });
  });

  it("ignores disabled, archived, wrong-scope, and nonmatching rules", () => {
    const result = evaluatePolicyRules(
      input,
      [
        rule({ id: "disabled", enabled: false }),
        rule({ id: "archived", archivedAt: evaluatedAt }),
        rule({ id: "other-product", productId: "product-2" }),
        rule({ id: "wrong-kind", conditions: { toolKind: "APPLICATION" } }),
      ],
      [],
    );
    expect(result.source).toBe("DEFAULT");
  });

  it("orders matching rules by priority, then specificity, then restrictiveness, then id", () => {
    expect(
      evaluatePolicyRules(
        input,
        [
          rule({ id: "specific-block", priority: 5, action: "BLOCK", productId: "product-1" }),
          rule({ id: "higher-priority-allow", priority: 6, action: "ALLOW", deviceId: "device-1" }),
        ],
        [],
      ).matchedRuleId,
    ).toBe("higher-priority-allow");

    expect(
      evaluatePolicyRules(
        input,
        [
          rule({ id: "global-block", priority: 5, action: "BLOCK" }),
          rule({ id: "scoped-allow", priority: 5, action: "ALLOW", productId: "product-1" }),
        ],
        [],
      ).matchedRuleId,
    ).toBe("scoped-allow");

    expect(
      evaluatePolicyRules(
        input,
        [
          rule({ id: "allow", priority: 5, action: "ALLOW" }),
          rule({ id: "warn", priority: 5, action: "WARN" }),
          rule({ id: "block", priority: 5, action: "BLOCK" }),
        ],
        [],
      ).matchedRuleId,
    ).toBe("block");

    expect(
      evaluatePolicyRules(input, [rule({ id: "z-rule" }), rule({ id: "a-rule" })], [])
        .matchedRuleId,
    ).toBe("a-rule");
  });

  it("uses deterministic tie breaking regardless of input ordering (generated priority property)", () => {
    for (let priority = -8; priority <= 8; priority += 1) {
      const actions = ["ALLOW", "WARN", "REQUIRE_OVERRIDE", "BLOCK"] as const;
      const rules = Array.from({ length: 9 }, (_, index) =>
        rule({
          id: `generated-${String(index).padStart(2, "0")}`,
          priority,
          action: actions[index % actions.length] ?? "ALLOW",
          deviceId: index % 3 === 0 ? "device-1" : null,
          productId: index % 2 === 0 ? "product-1" : null,
        }),
      );
      const expected = evaluatePolicyRules(input, rules, []);
      for (let shift = 0; shift < rules.length; shift += 1) {
        const rotated = [...rules.slice(shift), ...rules.slice(0, shift)];
        expect(evaluatePolicyRules(input, rotated, []).matchedRuleId).toBe(expected.matchedRuleId);
      }
    }
  });

  it("treats WARN as allowed while BLOCK and REQUIRE_OVERRIDE deny", () => {
    expect(evaluatePolicyRules(input, [rule({ action: "WARN" })], []).allowed).toBe(true);
    expect(evaluatePolicyRules(input, [rule({ action: "BLOCK" })], []).allowed).toBe(false);
    expect(evaluatePolicyRules(input, [rule({ action: "REQUIRE_OVERRIDE" })], []).allowed).toBe(
      false,
    );
  });

  it("rejects an invalid evaluation timestamp", () => {
    expect(() => evaluatePolicyRules({ ...input, evaluatedAt: "not-a-date" }, [], [])).toThrow(
      "valid timestamp",
    );
  });
});

describe("policy schedules", () => {
  it("includes the start minute and excludes the end minute in the schedule timezone", () => {
    const scheduled = rule({
      schedule: {
        timezone: "UTC",
        daysOfWeek: [5],
        startTime: "09:00",
        endTime: "17:00",
      },
    });
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-01T09:00:00Z" }, [scheduled], [])
        .source,
    ).toBe("RULE");
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-01T16:59:00Z" }, [scheduled], [])
        .source,
    ).toBe("RULE");
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-01T17:00:00Z" }, [scheduled], [])
        .source,
    ).toBe("DEFAULT");
  });

  it("applies overnight windows to the selected start day", () => {
    const scheduled = rule({
      schedule: {
        timezone: "UTC",
        daysOfWeek: [5],
        startTime: "22:00",
        endTime: "02:00",
      },
    });
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-01T23:30:00Z" }, [scheduled], [])
        .source,
    ).toBe("RULE");
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-02T01:59:00Z" }, [scheduled], [])
        .source,
    ).toBe("RULE");
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-02T02:00:00Z" }, [scheduled], [])
        .source,
    ).toBe("DEFAULT");
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-02T23:00:00Z" }, [scheduled], [])
        .source,
    ).toBe("DEFAULT");
  });

  it("enforces absolute start inclusive and end exclusive bounds", () => {
    const scheduled = rule({
      schedule: {
        timezone: "UTC",
        daysOfWeek: [5],
        startTime: "00:00",
        endTime: "23:59",
        startsAt: "2026-05-01T12:00:00Z",
        endsAt: "2026-05-01T13:00:00Z",
      },
    });
    expect(evaluatePolicyRules(input, [scheduled], []).source).toBe("RULE");
    expect(
      evaluatePolicyRules({ ...input, evaluatedAt: "2026-05-01T13:00:00Z" }, [scheduled], [])
        .source,
    ).toBe("DEFAULT");
  });
});

describe("policy overrides", () => {
  it("takes precedence over rules and reports its reason", () => {
    expect(evaluatePolicyRules(input, [rule()], [override()])).toMatchObject({
      action: "ALLOW",
      allowed: true,
      source: "OVERRIDE",
      matchedOverrideId: "override-1",
      reason: "User override",
    });
  });

  it("ignores revoked, future, expired, and wrong-scope overrides", () => {
    const candidates = [
      override({ id: "revoked", revokedAt: evaluatedAt }),
      override({ id: "future", startsAt: "2026-05-01T12:00:00.001Z" }),
      override({ id: "expired", expiresAt: evaluatedAt }),
      override({ id: "wrong-device", deviceId: "device-2" }),
    ];
    expect(evaluatePolicyRules(input, [], candidates).source).toBe("DEFAULT");
  });

  it("prefers the most specific active override, then newest, then stable tie breaks", () => {
    const candidates = [
      override({ id: "global-exact", toolKey: "app.example.com", action: "BLOCK" }),
      override({
        id: "device-wildcard",
        deviceId: "device-1",
        toolKey: "*.example.com",
        action: "BLOCK",
      }),
      override({
        id: "product-device-exact",
        productId: "product-1",
        deviceId: "device-1",
        toolKey: "app.example.com",
        action: "ALLOW",
      }),
    ];
    expect(evaluatePolicyRules(input, [], candidates).matchedOverrideId).toBe(
      "product-device-exact",
    );
    expect(
      evaluatePolicyRules(
        input,
        [],
        [
          override({ id: "older", createdAt: "2026-05-01T09:00:00Z", action: "ALLOW" }),
          override({ id: "newer", createdAt: "2026-05-01T11:00:00Z", action: "BLOCK" }),
        ],
      ).matchedOverrideId,
    ).toBe("newer");
    expect(
      evaluatePolicyRules(
        input,
        [],
        [override({ id: "b", action: "ALLOW" }), override({ id: "a", action: "BLOCK" })],
      ).matchedOverrideId,
    ).toBe("a");
  });
});
