const api = globalThis.browser ?? globalThis.chrome;
const form = document.getElementById("login-form") as HTMLFormElement;
const apiUrlInput = document.getElementById("api-url") as HTMLInputElement;
const emailInput = document.getElementById("email") as HTMLInputElement;
const passwordInput = document.getElementById("password") as HTMLInputElement;
const accessTokenInput = document.getElementById("access-token") as HTMLTextAreaElement;
const button = document.getElementById("connect-button") as HTMLButtonElement;
const messageBox = document.getElementById("settings-message")!;
const errorBox = document.getElementById("settings-error")!;

async function send(type: string, fields: Record<string, unknown> = {}) {
  const result = await api.runtime.sendMessage({ type, ...fields });
  if (result?.error) throw new Error(result.error);
  return result;
}

function show(target: HTMLElement, message: string) {
  target.textContent = message;
  target.hidden = !message;
}

void send("GET_STATE")
  .then((state) => {
    if (state.apiBaseUrl) apiUrlInput.value = state.apiBaseUrl;
    if (state.email) emailInput.value = state.email;
    if (state.connected)
      show(
        messageBox,
        `Connected as ${state.email}. Use the extension popup to sync policy and manage focus mode.`,
      );
  })
  .catch(() => undefined);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  show(messageBox, "");
  show(errorBox, "");
  button.disabled = true;
  button.textContent = "Requesting API access…";
  try {
    const url = new URL(apiUrlInput.value.trim());
    const pattern = `${url.origin}/*`;
    const permitted = await api.permissions.request({ origins: [pattern] });
    if (!permitted)
      throw new Error(
        "API access was not granted. The extension needs permission to reach this API origin.",
      );
    button.textContent = "Signing in…";
    const token = accessTokenInput.value.trim();
    const state = token
      ? await send("LOGIN_TOKEN", { apiBaseUrl: url.origin, accessToken: token })
      : emailInput.value.trim() && passwordInput.value
        ? await send("LOGIN", {
            apiBaseUrl: url.origin,
            email: emailInput.value,
            password: passwordInput.value,
            deviceName: navigator.userAgent.includes("Firefox")
              ? "Enough Firefox extension"
              : "Enough Chromium extension",
          })
        : (() => {
            throw new Error("Enter email and password or paste a one-time extension token.");
          })();
    if (!state.connected)
      throw new Error(state.syncError || "The session could not be confirmed. Sign in again.");
    passwordInput.value = "";
    accessTokenInput.value = "";
    show(
      messageBox,
      state.syncError
        ? `Connected as ${state.email}. Policy sync is pending: ${state.syncError}`
        : `Connected as ${state.email}. Your browser policy is synced.`,
    );
  } catch (cause) {
    show(errorBox, cause instanceof Error ? cause.message : "Could not connect to Enough.");
  } finally {
    button.disabled = false;
    button.textContent = "Grant API access and sign in";
  }
});
