import { isolatedEnvironment } from "./subprocess-environment.mjs";

const optionEnvironmentNames = new Map([
  ["sslmode", "PGSSLMODE"],
  ["sslrootcert", "PGSSLROOTCERT"],
  ["sslcert", "PGSSLCERT"],
  ["sslkey", "PGSSLKEY"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"],
  ["application_name", "PGAPPNAME"],
  ["target_session_attrs", "PGTARGETSESSIONATTRS"],
]);

export function postgresCliEnvironment(connectionString, databaseOverride) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash) {
    throw new Error("A valid PostgreSQL connection URL is required.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database && !databaseOverride)
    throw new Error("The PostgreSQL connection URL must name a database.");

  const environment = isolatedEnvironment(process.env);

  Object.assign(environment, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: databaseOverride || database,
  });
  if (url.username) environment.PGUSER = decodeURIComponent(url.username);
  if (url.password) environment.PGPASSWORD = decodeURIComponent(url.password);

  for (const [key, value] of url.searchParams) {
    const name = optionEnvironmentNames.get(key);
    if (!name) throw new Error(`Unsupported PostgreSQL connection option: ${key}`);
    environment[name] = value;
  }
  return environment;
}
