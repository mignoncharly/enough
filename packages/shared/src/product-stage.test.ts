import { describe, expect, it } from "vitest";
import {
  isLaunchedProductStage,
  LAUNCHED_PRODUCT_STAGES,
  PRODUCT_STAGE_GUIDANCE,
  PRODUCT_STAGE_LABELS,
  PRODUCT_STAGES,
} from "./product-stage.js";

describe("product stage catalog", () => {
  it("provides a unique label and actionable guidance for every stage", () => {
    expect(new Set(PRODUCT_STAGES).size).toBe(PRODUCT_STAGES.length);
    for (const stage of PRODUCT_STAGES) {
      expect(PRODUCT_STAGE_LABELS[stage].trim()).not.toBe("");
      expect(PRODUCT_STAGE_GUIDANCE[stage].headline.trim()).not.toBe("");
      expect(PRODUCT_STAGE_GUIDANCE[stage].priorities.length).toBeGreaterThan(0);
      expect(PRODUCT_STAGE_GUIDANCE[stage].signals.length).toBeGreaterThan(0);
      expect(PRODUCT_STAGE_GUIDANCE[stage].tasks.length).toBeGreaterThan(0);
      expect(
        PRODUCT_STAGE_GUIDANCE[stage].buildPercent + PRODUCT_STAGE_GUIDANCE[stage].marketPercent,
      ).toBe(100);
    }
  });

  it("classifies exactly the launched stages as launched", () => {
    const launched = new Set(LAUNCHED_PRODUCT_STAGES);
    expect(LAUNCHED_PRODUCT_STAGES.length).toBeGreaterThan(0);
    for (const stage of PRODUCT_STAGES)
      expect(isLaunchedProductStage(stage)).toBe(launched.has(stage));
    expect(isLaunchedProductStage("IDEA")).toBe(false);
    expect(isLaunchedProductStage("GROWTH")).toBe(true);
  });
});
