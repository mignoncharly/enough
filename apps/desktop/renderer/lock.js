const bridge = window.enough;
const title = document.getElementById("lock-title");
const copy = document.getElementById("lock-copy");
const reason = document.getElementById("lock-reason");
const error = document.getElementById("lock-error");

function render(state) {
  const app = state.currentApplication;
  title.textContent = app?.displayName
    ? `Take a moment before using ${app.displayName}`
    : "Return to your work";
  copy.textContent = "This application is restricted by your current focus policy.";
  reason.textContent =
    state.decision?.reason || "Switch to an allowed app and this screen will close automatically.";
}

document.getElementById("lock-bypass-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  try {
    await bridge.emergencyBypass({
      reason: document.getElementById("lock-bypass-reason").value,
      minutes: document.getElementById("lock-bypass-minutes").value,
    });
    document.getElementById("lock-bypass-reason").value = "";
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "The emergency bypass could not be saved.";
  }
});

bridge.onState(render);
void bridge
  .getState()
  .then(render)
  .catch(() => {});
