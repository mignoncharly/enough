// Pure, dependency-injected boundary. Importing never enables networking.
export const capabilities = Object.freeze([
  "ONBOARDING_ANALYSIS",
  "TASK_GENERATION",
  "SCOPE_CHALLENGE",
  "WEEKLY_DIAGNOSIS",
  "NEXT_ACTION",
  "OVERBUILDING_EXPLANATION",
  "EVIDENCE_CLASSIFICATION",
]);
const destination = "https://api.openai.com/v1/responses";
export function createProviderBoundary({
  transport,
  consent,
  inspectPrivacy,
  persist,
  key,
  model,
}) {
  let active = null,
    busy = false,
    stopped = false;
  const ledger = [];
  const used = new Set();
  function fail() {
    stopped = true;
    throw new Error("Phase 15 provider boundary stopped");
  }
  return {
    ledger,
    disable() {
      stopped = true;
      active = null;
    },
    select(capability) {
      if (
        stopped ||
        busy ||
        active ||
        !capabilities.includes(capability) ||
        used.has(capability) ||
        (ledger.length > 0 && ledger.at(-1).outcome !== "SCHEMA_VALID_APPLICATION_SUCCESS")
      )
        fail();
      active = capability;
    },
    async fetch(url, init) {
      if (stopped || busy || !active || ledger.length >= 7 || url !== destination) fail();
      busy = true;
      const capability = active;
      active = null;
      used.add(capability);
      let row;
      try {
        const body = JSON.parse(init.body);
        const context = JSON.parse(body.input?.[1]?.content?.[0]?.text);
        if (
          init.method !== "POST" ||
          init.redirect !== "error" ||
          body.store !== false ||
          body.model !== model ||
          context.capability !== capability ||
          new Headers(init.headers).get("authorization") !== `Bearer ${key}` ||
          !(await consent())
        )
          fail();
        await inspectPrivacy();
        if (stopped) fail();
        row = { capability, attempt: 1, startedAt: new Date().toISOString(), outcome: "STARTED" };
        ledger.push(row);
        await persist(ledger); // Durable reservation before submission; never retry an uncertain attempt.
        if (stopped) fail();
        const started = Date.now();
        const response = await transport(destination, init);
        row.httpCategory = response.ok
          ? "2XX"
          : response.status === 401 || response.status === 403
            ? "AUTH_OR_PERMISSION"
            : "PROVIDER_ERROR";
        row.latencyMs = Math.max(0, Date.now() - started);
        if (!response.ok) fail();
        const envelope = await response.clone().json();
        row.completion =
          envelope.status === "completed"
            ? "COMPLETED"
            : envelope.status === "incomplete"
              ? "INCOMPLETE"
              : "OTHER";
        const messages = envelope.output?.filter((item) => item.type === "message");
        if (messages?.some((item) => item.content?.some((part) => part.type === "refusal"))) {
          row.completion = "REFUSED";
          fail();
        }
        if (
          envelope.status !== "completed" ||
          envelope.error != null ||
          messages?.length !== 1 ||
          messages[0].status !== "completed" ||
          messages[0].role !== "assistant" ||
          messages[0].content?.length !== 1 ||
          messages[0].content[0].type !== "output_text"
        )
          fail();
        // Keep provider text only in caller memory for the log privacy comparison.
        await inspectPrivacy(init.body, messages[0].content[0].text);
        row.outcome = "COMPLETED_PENDING_APPLICATION_VALIDATION";
        return response;
      } catch {
        stopped = true;
        if (row) row.outcome = "STOPPED";
        throw new Error("Phase 15 provider attempt stopped; raw details withheld");
      } finally {
        busy = false;
        if (row) row.completedAt = new Date().toISOString();
        await persist(ledger);
      }
    },
    async accepted() {
      const row = ledger.at(-1);
      if (stopped || busy || row?.outcome !== "COMPLETED_PENDING_APPLICATION_VALIDATION") fail();
      await inspectPrivacy();
      row.outcome = "SCHEMA_VALID_APPLICATION_SUCCESS";
      await persist(ledger);
    },
  };
}
