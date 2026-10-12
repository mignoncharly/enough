// Compatibility entrypoint retained for operators using the earlier script path.
void import("../apps/api/src/phase13-migrate-evidence-objects.ts").catch(() => {
  console.error("Evidence object migration failed.");
  process.exitCode = 1;
});
