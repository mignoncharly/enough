const attempts = Number(process.env.VERIFY_ATTEMPTS || 12);
const delayMs = Number(process.env.VERIFY_DELAY_MS || 5_000);
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS || 5_000);

if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
  throw new Error("VERIFY_ATTEMPTS must be an integer from 1 to 60.");
}

const port = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return value;
};

const services = [
  { name: "web", url: `http://127.0.0.1:${port("WEB_PORT", 3000)}/api/ready` },
  { name: "api", url: `http://127.0.0.1:${port("API_PORT", 4000)}/ready` },
  { name: "worker", url: `http://127.0.0.1:${port("WORKER_PORT", 4001)}/ready` },
];

async function check(service) {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(timeoutMs) });
    const payload = await response.json();
    return response.ok && payload?.service === service.name && payload?.status === "ok";
  } catch {
    return false;
  }
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const results = await Promise.all(
    services.map(async (service) => [service, await check(service)]),
  );
  const failed = results.filter(([, ready]) => !ready).map(([service]) => service.name);
  if (failed.length === 0) {
    console.info("Ready: web, API, worker, PostgreSQL, and Redis.");
    process.exit(0);
  }
  if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  else {
    console.error(`Readiness failed after ${attempts} attempt(s): ${failed.join(", ")}.`);
    process.exitCode = 1;
  }
}
