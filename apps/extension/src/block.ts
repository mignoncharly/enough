const api = globalThis.browser ?? globalThis.chrome;
const query = new URLSearchParams(window.location.search);
const tabId = Number(query.get("tabId"));

async function send(type: string, fields: Record<string, unknown> = {}) {
  const result = await api.runtime.sendMessage({ type, ...fields });
  if (result?.error) throw new Error(result.error);
  return result;
}

void send("BLOCK_INFO", { tabId }).then((block) => {
  if (!block) return;
  document.getElementById("block-host")!.textContent = block.host;
  document.getElementById("block-reason")!.textContent =
    block.reason || "Your current Enough policy paused this development site.";
});

document.getElementById("growth-button")!.addEventListener("click", async () => {
  const status = document.getElementById("block-message")!;
  status.hidden = false;
  status.textContent = "Starting your Growth Session…";
  try {
    await send("START_GROWTH", { tabId });
  } catch (cause) {
    status.textContent = cause instanceof Error ? cause.message : "Could not start Growth Mode.";
  }
});

document.getElementById("back-button")!.addEventListener("click", () => window.history.back());
