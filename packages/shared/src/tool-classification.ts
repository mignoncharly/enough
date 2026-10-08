export const TOOL_CLASSIFICATIONS = [
  "BUILD",
  "GROWTH",
  "NEUTRAL",
  "CONTEXTUAL",
  "BLOCKED",
  "ALLOWED",
] as const;

export type ToolClassification = (typeof TOOL_CLASSIFICATIONS)[number];
export const TOOL_KINDS = ["APPLICATION", "DOMAIN"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export interface ToolClassificationEntry {
  toolKind: ToolKind;
  toolKey: string;
  displayName: string;
  classification: ToolClassification;
  productId?: string | null;
  contextKey?: string;
  contextValue?: string;
}

export interface ToolClassificationInput {
  toolKind: ToolKind;
  toolKey: string;
  productId?: string | null;
  contextKey?: string;
  contextValue?: string;
}

export interface ToolClassificationResolution {
  toolKind: ToolKind;
  toolKey: string;
  classification: ToolClassification;
  displayName: string;
  matchedKey: string | null;
  source: "PRODUCT_MAPPING" | "ACCOUNT_MAPPING" | "CATALOG" | "FALLBACK";
  contextMatched: boolean;
}

export function normalizeToolKey(toolKind: ToolKind, rawValue: string): string {
  const value = rawValue.trim();
  if (toolKind === "APPLICATION") {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in untrusted identifiers.
    if (!value || value.length > 253 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error("Enter a valid application identifier.");
    }
    return value.toLocaleLowerCase("en-US");
  }

  const wildcard = value.startsWith("*.");
  const source = wildcard ? value.slice(2) : value;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in untrusted domain input.
  if (!source || /[\u0000-\u001f\u007f]/.test(source))
    throw new Error("Enter a valid domain name.");
  let hostname: string;
  try {
    const url = new URL(source.includes("://") ? source : `https://${source}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid protocol");
    if (url.username || url.password) throw new Error("Credentials are not a domain");
    hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
  } catch {
    throw new Error("Enter a valid domain name, such as example.com or *.example.com.");
  }
  if (
    hostname.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(
      hostname,
    )
  ) {
    throw new Error("Enter a valid domain name, such as example.com or *.example.com.");
  }
  return wildcard ? `*.${hostname}` : hostname;
}

export function toolKeyMatches(toolKind: ToolKind, ruleKey: string, inputKey: string): boolean {
  if (ruleKey === inputKey) return true;
  return (
    toolKind === "DOMAIN" && ruleKey.startsWith("*.") && inputKey.endsWith(`.${ruleKey.slice(2)}`)
  );
}

export function resolveToolClassification(
  input: ToolClassificationInput,
  mappings: readonly ToolClassificationEntry[],
  catalog: readonly ToolClassificationEntry[],
): ToolClassificationResolution {
  const toolKey = normalizeToolKey(input.toolKind, input.toolKey);
  const contextKey = input.contextKey?.trim().toLocaleLowerCase("en-US") ?? "";
  const contextValue = input.contextValue?.trim().toLocaleLowerCase("en-US") ?? "";
  const candidate = (
    entry: ToolClassificationEntry,
    source: ToolClassificationResolution["source"],
  ) => {
    if (
      entry.toolKind !== input.toolKind ||
      !toolKeyMatches(input.toolKind, entry.toolKey, toolKey)
    )
      return null;
    const productId = entry.productId ?? null;
    const inputProductId = input.productId ?? null;
    if (productId && productId !== inputProductId) return null;
    const entryContextKey = entry.contextKey ?? "";
    const entryContextValue = entry.contextValue ?? "";
    const contextMatched = Boolean(
      entryContextKey &&
        entryContextValue &&
        contextKey === entryContextKey.toLocaleLowerCase("en-US") &&
        contextValue === entryContextValue.toLocaleLowerCase("en-US"),
    );
    if ((entryContextKey || entryContextValue) && !contextMatched) return null;
    return {
      entry,
      source,
      productSpecific: productId !== null,
      contextMatched,
      specificity: entry.toolKey.startsWith("*.")
        ? entry.toolKey.length - 1
        : entry.toolKey.length + 10_000,
    };
  };

  const options = [
    ...mappings.map((entry) =>
      candidate(entry, entry.productId ? "PRODUCT_MAPPING" : "ACCOUNT_MAPPING"),
    ),
    ...catalog.map((entry) => candidate(entry, "CATALOG")),
  ].filter((value): value is NonNullable<typeof value> => value !== null);
  options.sort((a, b) => {
    const precedence =
      Number(b.productSpecific) - Number(a.productSpecific) ||
      Number(b.contextMatched) - Number(a.contextMatched) ||
      b.specificity - a.specificity ||
      Number(a.source === "CATALOG") - Number(b.source === "CATALOG");
    if (precedence) return precedence;
    return a.entry.toolKey === b.entry.toolKey ? 0 : a.entry.toolKey < b.entry.toolKey ? -1 : 1;
  });
  const chosen = options[0];
  if (!chosen) {
    return {
      toolKind: input.toolKind,
      toolKey,
      classification: "NEUTRAL",
      displayName: toolKey,
      matchedKey: null,
      source: "FALLBACK",
      contextMatched: false,
    };
  }
  return {
    toolKind: input.toolKind,
    toolKey,
    classification: chosen.entry.classification,
    displayName: chosen.entry.displayName,
    matchedKey: chosen.entry.toolKey,
    source: chosen.source,
    contextMatched: chosen.contextMatched,
  };
}
