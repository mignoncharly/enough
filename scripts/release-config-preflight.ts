// Trusted, offline configuration validation only. No DB/provider connections or writes.
async function main() {
  try {
    await import("../packages/config/src/index.ts");
    if (
      process.env.NODE_ENV !== "production" ||
      !process.env.DATABASE_URL?.trim() ||
      !process.env.REDIS_URL?.trim() ||
      process.env.ENOUGH_PHASE14_MICROSOFT_LOCALHOST_CALLBACK === "1"
    )
      throw new Error();
    console.info(
      "Production runtime configuration: PASS (no connectivity or release approval implied).",
    );
  } catch {
    console.error(
      "Production runtime configuration: BLOCKED. Review the protected environment against infra/README.md; values are not logged.",
    );
    process.exitCode = 1;
  }
}
void main();
