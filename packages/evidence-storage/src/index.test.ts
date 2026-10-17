import { afterEach, expect, it, vi } from "vitest";

// This unit exercises the storage guard, not database configuration at import.
// The production environment validator independently rejects this endpoint.
vi.mock("@enough/db", () => ({ pool: {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("rejects non-loopback plain HTTP endpoints before using storage credentials", async () => {
  vi.stubEnv("EVIDENCE_STORAGE_BUCKET", "private-test-bucket");
  vi.stubEnv("EVIDENCE_STORAGE_REGION", "us-east-1");
  vi.stubEnv("EVIDENCE_STORAGE_ACCESS_KEY_ID", "fixture-access-key");
  vi.stubEnv("EVIDENCE_STORAGE_SECRET_ACCESS_KEY", "fixture-secret-key");
  vi.stubEnv("EVIDENCE_STORAGE_ENDPOINT", "http://storage.example.invalid");

  const { EvidenceStorageConfigurationError, evidenceObjectStore, closeEvidenceObjectStore } =
    await import("./index.js");
  try {
    expect(() => evidenceObjectStore()).toThrow(EvidenceStorageConfigurationError);
  } finally {
    await closeEvidenceObjectStore();
  }
});
