import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

const identities = new WeakSet();
export function isGtagSeedIdentity(value) {
  return value !== null && typeof value === "object" && identities.has(value);
}

// One-use loopback transfer from an already-running seed fixture. The handoff
// nonce and IDs are never logged; IDs are never written to disk.
export async function receiveGtagSeedHandoff({ url, nonce }) {
  if (url !== "http://127.0.0.1:4431/identity" || !/^[a-f0-9-]{36}$/.test(nonce ?? ""))
    throw new Error("Invalid local gtag handoff settings.");
  const response = await fetch(url, {
    headers: { "x-seed-handoff": nonce },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "Local gtag handoff unavailable.");
  const text = await response.text();
  assert.ok(text.length <= 2048, "Invalid local gtag handoff.");
  const value = JSON.parse(text);
  const sessionId = Number(value.sessionId);
  if (
    value.source !== "gtag_callback" ||
    !/^[1-9]\d*\.[1-9]\d*$/.test(value.clientId ?? "") ||
    !Number.isSafeInteger(sessionId) ||
    sessionId <= 0
  )
    throw new Error("Invalid local gtag handoff.");
  const identity = Object.freeze({ clientId: value.clientId, sessionId });
  identities.add(identity);
  return identity;
}

// IDs arrive only through the local, same-origin browser bridge after its one
// gtag seed callback. They stay in memory; neither IDs nor request bodies log.
export async function createGtagSeedFixture({ measurementId, claimSeed, port = 4430 }) {
  assert.match(measurementId, /^G-[A-Z0-9]{5,30}$/);
  const nonce = randomUUID();
  let claimed = false;
  let claimComplete = false;
  let identity = null;
  let resolveIdentity;
  const received = new Promise((resolve) => {
    resolveIdentity = resolve;
  });
  let origin;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(503);
      res.end("Local seed operation failed; do not retry the seed.");
    });
  });
  async function handle(req, res) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "same-origin");
    if (req.headers.host !== new URL(origin).host) return res.writeHead(403).end();
    if (req.method === "GET" && req.url === "/") {
      const page = `<!doctype html><meta charset="utf-8"><title>Phase 14 GA4 client seed</title>
<h1>Local GA4 acceptance seed</h1><p>This sends one harmless client seed. No Measurement Protocol secret is in this page.</p>
<button id="seed">Send one client seed</button><p id="status">Ready</p>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(measurementId)}, {send_page_view:false,cookie_expires:0,allow_google_signals:false,allow_ad_personalization_signals:false});
const target=${JSON.stringify(measurementId)}, nonce=${JSON.stringify(nonce)};
const button=document.getElementById('seed'), status=document.getElementById('status');
button.onclick=async()=>{
 button.disabled=true;
 try {
  const claim=await fetch('/seed-claim',{method:'POST',headers:{'x-seed-nonce':nonce}});
  if(!claim.ok) throw new Error();
  status.textContent='Sending one seed; do not reload or click again.';
  gtag('event','phase14_clean_client_seed',{send_to:target,engagement_time_msec:1,event_callback:()=>{
   gtag('get',target,'client_id',clientId=>{
    gtag('get',target,'session_id',async sessionId=>{
     try {
      const result=await fetch('/identity',{method:'POST',headers:{'content-type':'application/json','x-seed-nonce':nonce},body:JSON.stringify({clientId,sessionId,seedCompleted:true})});
      status.textContent=result.ok?'Seed callback and client/session received. Keep this page open.':'Identity handoff failed; do not resend the seed.';
     }catch{status.textContent='Identity handoff failed; do not resend the seed.';}
    });
   });
  }});
 }catch{status.textContent='Seed unavailable or already attempted; do not retry.';}
};
</script><script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}"></script>`;
      return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    }
    if (
      req.method !== "POST" ||
      req.headers.origin !== origin ||
      req.headers["x-seed-nonce"] !== nonce
    )
      return res.writeHead(403).end();
    if (req.url === "/seed-claim") {
      if (claimed) return res.writeHead(409).end();
      // Claim synchronously before awaiting disk IO to prevent concurrent clicks.
      claimed = true;
      await claimSeed();
      claimComplete = true;
      return res.writeHead(204).end();
    }
    if (req.url === "/identity") {
      if (!claimComplete || identity) return res.writeHead(409).end();
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) return res.writeHead(413).end();
      }
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        return res.writeHead(400).end();
      }
      const sessionId = Number(value.sessionId);
      if (
        value.seedCompleted !== true ||
        !/^[1-9]\d*\.[1-9]\d*$/.test(value.clientId ?? "") ||
        !Number.isSafeInteger(sessionId) ||
        sessionId <= 0
      )
        return res.writeHead(400).end();
      identity = Object.freeze({ clientId: value.clientId, sessionId });
      identities.add(identity);
      res.writeHead(204).end();
      resolveIdentity(identity);
      return;
    }
    res.writeHead(404).end();
  }
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: origin,
    waitForIdentity: () => received,
    close: async () => {
      if (identity) identities.delete(identity);
      identity = null;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
