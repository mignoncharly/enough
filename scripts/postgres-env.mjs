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

  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("PG")) delete environment[key];
  }
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "AUTH_SECRET",
    "RESEND_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRETS",
    "OPENAI_API_KEY",
    "RESTORE_ADMIN_DATABASE_URL",
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_AGE_IDENTITY_FILE",
    "BACKUP_RCLONE_DEST",
  ])
    delete environment[key];

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
