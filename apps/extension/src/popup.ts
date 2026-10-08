const api = globalThis.browser ?? globalThis.chrome;
const byId = (id: string) => document.getElementById(id)!;
const status = byId("connection-status");
const errorBox = byId("extension-error");
const signedIn = byId("signed-in");
const signedOut = byId("signed-out");

async function send(type: string, fields: Record<string, unknown> = {}) {
  const result = await api.runtime.sendMessage({ type, ...fields });
  if (result?.error) throw new Error(result.error);
  return result;
}

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function render(state: any) {
  signedIn.hidden = !state.connected;
  signedOut.hidden = state.connected;
  status.textContent = state.connected ? `Connected as ${state.email}` : "Not connected";
  const warnings = [
    state.policyStale
      ? "Cached policy is expired or the system clock moved backwards; extension enforcement is paused until sync succeeds."
      : "",
    state.unsupportedRules
      ? `${state.unsupportedRules} domain patterns could not be installed.`
      : "",
    state.truncatedCandidates
      ? "Only the first 900 domain policy candidates are enforced; narrow broad rules."
      : "",
    state.discardedEvents
      ? `${state.discardedEvents} activity events were discarded after queue or offline-retention limits.`
      : "",
  ].filter(Boolean);
  showError([state.syncError, ...warnings].filter(Boolean).join(" "));
  if (!state.connected) return;

  const productSelect = byId("product-select") as HTMLSelectElement;
  productSelect.replaceChildren(
    ...state.products.map((product: any) => {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = product.name;
      option.selected = product.id === state.selectedProductId;
      return option;
    }),
  );
  productSelect.disabled = state.products.length === 0;
  (byId("build-mode") as HTMLButtonElement).setAttribute(
    "aria-pressed",
    String(state.mode !== "GROWTH"),
  );
  (byId("growth-mode") as HTMLButtonElement).setAttribute(
    "aria-pressed",
    String(state.mode === "GROWTH"),
  );
  byId("mode-description").textContent =
    state.mode === "GROWTH"
      ? `Growth Mode runs until ${new Date(state.growthModeUntil).toLocaleTimeString()}. Market tools on the local allowlist are available.`
      : "Build Mode applies the synced policy to development domains.";
  const trackingToggle = byId("tracking-toggle") as HTMLInputElement;
  trackingToggle.checked = state.trackingEnabled;
  trackingToggle.disabled = !state.activityCollectionEnabled;
  byId("tracking-consent-status").textContent = state.activityCollectionEnabled
    ? "Account consent is on. This local toggle separately controls browser activity capture."
    : "Account-level activity consent is off. Grant it in Enough Privacy settings before enabling local tracking.";
  byId("sync-time").textContent = state.lastSyncAt
    ? new Date(state.lastSyncAt).toLocaleString()
    : "Never";
  byId("blocking-count").textContent = String(state.blockingRules);
  byId("event-count").textContent = String(state.queuedEvents);
  byId("native-status").textContent = state.nativeAgent ? "Connected" : "Not connected";
}

async function refresh() {
  try {
    render(await send("GET_STATE"));
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "Could not read extension status.");
  }
}

for (const [id, mode] of [
  ["build-mode", "BUILD"],
  ["growth-mode", "GROWTH"],
] as const) {
  byId(id).addEventListener("click", async () => {
    showError("");
    try {
      render(await send("SET_MODE", { mode }));
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "Could not change focus mode.");
    }
  });
}

byId("product-select").addEventListener("change", async (event) => {
  showError("");
  try {
    render(
      await send("SET_PRODUCT", { productId: (event.currentTarget as HTMLSelectElement).value }),
    );
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "Could not change product.");
  }
});

byId("tracking-toggle").addEventListener("change", async (event) => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  try {
    render(await send("SET_TRACKING", { enabled }));
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "Could not update tracking preference.");
    await refresh();
  }
});

byId("sync-button").addEventListener("click", async () => {
  showError("");
  try {
    render(await send("SYNC"));
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "Policy sync failed.");
  }
});

byId("native-button").addEventListener("click", async () => {
  showError("");
  try {
    render(await send("CONNECT_NATIVE"));
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "The desktop agent is unavailable.");
  }
});

byId("sign-out-button").addEventListener("click", async () => {
  try {
    render(await send("LOGOUT"));
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : "Sign out failed.");
  }
});

for (const id of ["settings-button", "configure-button"]) {
  byId(id).addEventListener("click", () => {
    void api.runtime.openOptionsPage();
  });
}

void refresh();
