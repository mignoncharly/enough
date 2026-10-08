# PostgreSQL production setup

Use the Ubuntu PostgreSQL package and keep it bound to loopback on a single-host deployment. Preserve the package's data directory and service unit; do not put PostgreSQL data under the application release directory.

Create the application role and database interactively as the PostgreSQL administrator:

```sh
sudo -u postgres createuser --login --pwprompt enough
sudo -u postgres createdb --owner=enough enough
```

Use a long generated password, URL-encode it in `DATABASE_URL`, and do not grant `SUPERUSER`, `CREATEDB`, or `CREATEROLE` to the application role. The migration runner creates the `enough` schema and migration ledger using that database owner.

Confirm `listen_addresses` is limited to `127.0.0.1` (and optionally `::1`) and local TCP authentication uses `scram-sha-256`. Keep the host firewall closed to port 5432. PostgreSQL readiness is checked by the API and web health endpoints.

Before every migration deployment, run the read-only migration precheck and create an encrypted, off-host database backup. The restore test creates a separate, timestamp-named database and drops only that generated database after verification. Never point the restore-test connection at production write credentials.
