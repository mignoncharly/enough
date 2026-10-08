const bridge = window.enough;
const byId = (id) => document.getElementById(id);
const errorLine = byId("error-message");
let lastState = null;

function escapeText(value) {
  return String(value ?? "");
}
function showError(error) {
  errorLine.textContent = error instanceof Error ? error.message : String(error);
}
function clearError() {
  errorLine.textContent = "";
}
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const remainder = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = escapeText(text);
  return element;
}

function renderApplications(applications) {
  const list = byId("applications");
  list.replaceChildren();
  if (!applications.length) {
    list.append(node("p", "muted", "Detected apps will appear here."));
    return;
  }
  for (const app of applications) {
    const row = node("div", "app-row");
    const identity = node("div", "app-identity");
    identity.append(node("strong", "", app.displayName || app.toolKey));
    identity.append(node("span", "mono muted", app.toolKey));
    row.append(identity);
    row.append(
      node(
        "span",
        "app-class",
        lastState?.localClassifications?.[app.toolKey] || app.classification || "NEUTRAL",
      ),
    );
    row.append(node("span", "app-time", formatDuration(app.seconds)));
    list.append(row);
  }
}

function render(state) {
  lastState = state;
  byId("login-card").classList.toggle("hidden", state.connected);
  byId("workspace").classList.toggle("hidden", !state.connected);
  byId("connection-label").textContent = state.connected ? "Connected" : "Not connected";
  byId("connection-dot").classList.toggle("online", state.connected);
  byId("user-email").textContent = state.email || "";
  byId("api-base").value = state.apiBaseUrl || byId("api-base").value || "";
  byId("storage-note").textContent =
    state.monitorWarning ||
    "Protected local storage is unavailable. Sign-in and offline policy cannot be saved on this system.";
  byId("storage-note").classList.toggle("hidden", state.storageAvailable && !state.monitorWarning);

  const productPicker = byId("product");
  const currentProduct = productPicker.value;
  productPicker.replaceChildren();
  if (!state.products.length) {
    const option = node("option", "", "No products yet");
    option.value = "";
    productPicker.append(option);
  } else {
    for (const product of state.products) {
      const option = node("option", "", product.name);
      option.value = product.id;
      productPicker.append(option);
    }
    productPicker.value = state.products.some((item) => item.id === currentProduct)
      ? currentProduct
      : state.selectedProductId;
  }
  productPicker.disabled = !state.products.length;

  const growth = state.mode === "GROWTH";
  byId("mode-title").textContent = growth ? "Growth Mode" : "Build Mode";
  byId("mode-pill").textContent = growth ? "GROWTH" : "BUILD";
  byId("mode-pill").className = `pill ${growth ? "growth" : "build"}`;
  byId("mode-copy").textContent =
    growth && state.growthModeUntil
      ? `Growth Mode ends at ${new Date(state.growthModeUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
      : "Your local rules are watching the active application.";
  byId("session-timer").textContent = formatDuration(state.sessionSeconds);
  byId("pause-session").textContent = state.sessionActive ? "Pause session" : "Resume session";

  const active = state.currentApplication;
  byId("active-name").textContent =
    active?.displayName || (state.isIdle ? "Paused while idle" : "Waiting for activity");
  byId("active-key").textContent =
    active?.toolKey || (state.isLocked ? "Screen locked" : "No application identifier yet");
  const decision = state.decision;
  byId("decision-pill").textContent = decision?.action || "—";
  byId("decision-pill").className =
    `pill ${decision?.allowed ? "allowed" : decision ? "restricted" : "neutral"}`;
  byId("decision-reason").textContent =
    decision?.reason ||
    state.syncError ||
    "When an app is detected, its local policy decision appears here.";
  const classification = byId("classification");
  classification.disabled = !active;
  const currentLocal = active ? state.localClassifications?.[active.toolKey] || "" : "";
  classification.value = currentLocal;

  byId("protection").checked = state.protectionEnabled;
  byId("tracking").checked = state.trackingEnabled;
  byId("tracking").disabled = !state.activityCollectionEnabled;
  byId("activity-consent-note").textContent = state.activityCollectionEnabled
    ? "Account consent is on. This local toggle separately controls desktop activity capture."
    : "Account-level activity consent is off. Grant it in Enough Privacy settings before enabling local tracking.";
  byId("autostart").checked = state.autoStart;
  byId("grace").value = String(state.gracePeriodSeconds);
  byId("sync-label").textContent = state.lastSyncAt
    ? `Last policy sync ${new Date(state.lastSyncAt).toLocaleString()}`
    : "Policy not synced";
  byId("update-status").textContent = state.updateStatus;
  byId("applications").dataset.signature = JSON.stringify(state.applications);
  renderApplications(state.applications);

  const notices = byId("notices");
  notices.replaceChildren();
  if (state.syncError) notices.append(node("p", "callout warning", state.syncError));
  if (state.policyStale)
    notices.append(
      node(
        "p",
        "callout warning",
        "The cached policy is expired or the system clock moved backwards. Local policy enforcement is paused until a successful sync.",
      ),
    );
  if (state.discardedEvents)
    notices.append(
      node(
        "p",
        "callout warning",
        `${state.discardedEvents} activity event${state.discardedEvents === 1 ? " was" : "s were"} discarded after queue or offline-retention limits.`,
      ),
    );
  if (state.monitorWarning) notices.append(node("p", "callout warning", state.monitorWarning));
  if (state.monitorCapability === "limited-lock-detection")
    notices.append(
      node(
        "p",
        "callout info",
        "This Linux session can monitor apps, but its desktop environment may not report screen-lock state.",
      ),
    );
}

async function action(operation) {
  clearError();
  try {
    render(await operation());
  } catch (error) {
    showError(error);
  }
}

byId("password-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(() =>
    bridge.login({
      apiBaseUrl: byId("api-base").value,
      email: byId("email").value,
      password: byId("password").value,
    }),
  );
});
byId("token-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(() =>
    bridge.loginWithToken({ apiBaseUrl: byId("api-base").value, accessToken: byId("token").value }),
  );
});
byId("sync-button").addEventListener("click", () => void action(() => bridge.sync()));
byId("logout-button").addEventListener("click", () => void action(() => bridge.logout()));
byId("signout-button").addEventListener("click", () => void action(() => bridge.logout()));
byId("build-mode").addEventListener("click", () => void action(() => bridge.setMode("BUILD")));
byId("growth-mode").addEventListener("click", () => void action(() => bridge.setMode("GROWTH")));
byId("pause-session").addEventListener(
  "click",
  () => void action(() => bridge.setPaused(lastState?.sessionActive)),
);
byId("product").addEventListener(
  "change",
  () => void action(() => bridge.setProduct(byId("product").value)),
);
byId("protection").addEventListener(
  "change",
  () => void action(() => bridge.setProtection(byId("protection").checked)),
);
byId("tracking").addEventListener(
  "change",
  () => void action(() => bridge.setTracking(byId("tracking").checked)),
);
byId("autostart").addEventListener(
  "change",
  () => void action(() => bridge.setAutoStart(byId("autostart").checked)),
);
byId("grace").addEventListener(
  "change",
  () => void action(() => bridge.setGracePeriod(byId("grace").value)),
);
byId("classification").addEventListener("change", () => {
  if (!lastState?.currentApplication) return;
  void action(() =>
    bridge.setLocalClassification(
      lastState.currentApplication.toolKey,
      byId("classification").value,
    ),
  );
});
byId("update-button").addEventListener("click", () => void action(() => bridge.update()));
byId("bypass-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(() =>
    bridge.emergencyBypass({
      reason: byId("bypass-reason").value,
      minutes: byId("bypass-minutes").value,
    }),
  ).then(() => {
    byId("bypass-reason").value = "";
  });
});

bridge.onState(render);
void bridge.getState().then(render).catch(showError);
