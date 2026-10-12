import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { closeEvidenceObjectStore, evidenceObjectStore } from "@enough/evidence-storage";
import { afterAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE13_INTEGRATION !== "1")(
  "Phase 13 legacy evidence object migration",
  () => {
    const sourceUrl = process.env.DATABASE_URL ?? "";
    const adminUrl = process.env.PHASE13_RESTORE_ADMIN_DATABASE_URL ?? "";

    function pgEnvironment(connectionString: string, databaseOverride?: string) {
      const parsed = new URL(connectionString);
      const environment = { ...process.env };
      for (const key of Object.keys(environment)) if (key.startsWith("PG")) delete environment[key];
      environment.PGHOST = parsed.hostname;
      environment.PGPORT = parsed.port || "5432";
      environment.PGUSER = decodeURIComponent(parsed.username);
      environment.PGPASSWORD = decodeURIComponent(parsed.password);
      environment.PGDATABASE = databaseOverride ?? parsed.pathname.slice(1);
      return environment;
    }

    function run(
      command: string,
      args: string[],
      environment: NodeJS.ProcessEnv,
      stdio: "ignore" | "inherit" = "ignore",
      cwd = process.cwd(),
    ) {
      return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          env: environment,
          stdio,
          windowsHide: true,
        });
        child.once("error", () =>
          reject(new Error("A PostgreSQL migration tool was unavailable.")),
        );
        child.once("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `The isolated legacy evidence migration step failed (${command.split(/[\\/]/).at(-1)}; exit ${code}).`,
                ),
              ),
        );
      });
    }

    function capture(command: string, args: string[], environment: NodeJS.ProcessEnv) {
      return new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: process.cwd(),
          env: environment,
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
        let output = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
        child.once("error", () =>
          reject(new Error("The isolated migration query tool was unavailable.")),
        );
        child.once("close", (code) =>
          code === 0
            ? resolve(output.trim())
            : reject(new Error("The isolated legacy evidence verification query failed.")),
        );
      });
    }

    it("moves a preexisting BYTEA upload only after checksum verification and restores private retrieval", async () => {
      const source = new URL(sourceUrl);
      const admin = new URL(adminUrl);
      expect([
        source.hostname,
        source.port,
        source.pathname,
        admin.hostname,
        admin.port,
        admin.pathname,
      ]).toEqual(["127.0.0.1", "55944", "/enough_phase13", "127.0.0.1", "55944", "/postgres"]);
      const databaseName = `enough_phase13_legacy_${randomUUID().replaceAll("-", "")}`;
      const target = new URL(sourceUrl);
      target.pathname = `/${databaseName}`;
      const fixtureOwner = decodeURIComponent(source.username);
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const accountId = randomUUID();
      const productId = randomUUID();
      const taskId = randomUUID();
      const seriesId = randomUUID();
      const completionId = randomUUID();
      const evidenceId = randomUUID();
      const beforeObjects = await evidenceObjectStore().list({ prefix: "obj-", maxKeys: 100 });
      const beforeStaging = await evidenceObjectStore().list({ prefix: "stage-", maxKeys: 100 });
      const knownKeys = new Set([
        ...beforeObjects.objects.map((item) => item.key),
        ...beforeStaging.objects.map((item) => item.key),
      ]);
      let databaseCreated = false;
      let objectKey: string | undefined;
      let stagingKey: string | undefined;

      try {
        console.info("Creating isolated Phase 13 legacy migration database.");
        await run(
          "createdb",
          [
            "--maintenance-db=postgres",
            `--owner=${fixtureOwner}`,
            "--template=template0",
            databaseName,
          ],
          pgEnvironment(adminUrl, "postgres"),
        );
        databaseCreated = true;
        const throughSeventeen = {
          ...process.env,
          DATABASE_URL: target.toString(),
          ENOUGH_MIGRATION_STOP_AFTER: "0017_precise_build_session_meter.sql",
        };
        console.info("Applying the legacy migration chain through 0017.");
        await run(
          process.execPath,
          ["--import", "tsx", "src/migrate.ts"],
          throughSeventeen,
          "inherit",
          resolve(process.cwd(), "packages", "db"),
        );

        const imageBase64 = bytes.toString("base64");
        const sql = `
          INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at)
          VALUES ('${accountId}', 'p13-migration-${accountId}@example.invalid', 'p13-migration-${accountId}@example.invalid', now());
          INSERT INTO enough.products (id, user_id, name, target_customer, problem_statement, product_stage)
          VALUES ('${productId}', '${accountId}', 'P13 migration product', 'Founders', 'Verify the legacy file migration', 'PROBLEM_VALIDATION');
          INSERT INTO enough.growth_tasks (id, user_id, product_id, series_id, title, status, completed_at)
          VALUES ('${taskId}', '${accountId}', '${productId}', '${seriesId}', 'Legacy file evidence task', 'COMPLETED', now());
          INSERT INTO enough.growth_task_completions (id, task_id, product_id, user_id, verification_status)
          VALUES ('${completionId}', '${taskId}', '${productId}', '${accountId}', 'AWAITING_EVIDENCE');
          INSERT INTO enough.task_evidence_items
            (id, completion_id, task_id, product_id, user_id, evidence_type, title, original_file_name,
             content_type, file_size, file_sha256, file_data, verification_status)
          VALUES ('${evidenceId}', '${completionId}', '${taskId}', '${productId}', '${accountId}',
            'UPLOAD', 'Legacy evidence migration', 'legacy.png', 'image/png', ${bytes.length},
            '${digest}', decode('${imageBase64}', 'base64'), 'PENDING');
        `;
        await run(
          "psql",
          ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--command", sql],
          pgEnvironment(target.toString()),
        );

        console.info("Running the checksum-verified BYTEA to object migration.");
        await run(
          process.execPath,
          ["scripts/phase13-evidence-storage-upgrade.mjs"],
          {
            ...process.env,
            DATABASE_URL: target.toString(),
          },
          "inherit",
        );
        const restoredRow = await capture(
          "psql",
          [
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--set=ON_ERROR_STOP=1",
            "--command",
            `SELECT storage_state || E'|' || original_file_name || E'|' || file_size::text || E'|' || file_sha256 || E'|' || storage_object_key FROM enough.task_evidence_items WHERE id = '${evidenceId}'::uuid`,
          ],
          pgEnvironment(target.toString()),
        );
        const [state, fileName, fileSize, fileSha256, storageKey] = restoredRow.split("|");
        objectKey = storageKey;
        expect([state, fileName, Number(fileSize), fileSha256?.trim()]).toEqual([
          "READY",
          "legacy.png",
          bytes.length,
          digest,
        ]);
        expect(objectKey).toMatch(/^obj-[A-Za-z0-9_-]{32,}$/);
        const legacyColumnCount = await capture(
          "psql",
          [
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--set=ON_ERROR_STOP=1",
            "--command",
            "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'enough' AND table_name = 'task_evidence_items' AND column_name = 'file_data'",
          ],
          pgEnvironment(target.toString()),
        );
        expect(legacyColumnCount).toBe("0");
        if (!objectKey) throw new Error("Migration produced no object key.");
        const migratedObject = await evidenceObjectStore().get(objectKey);
        expect(migratedObject.bytes).toEqual(bytes);
        expect(migratedObject.sha256).toBe(digest);
      } finally {
        if (databaseCreated) {
          const keys = await capture(
            "psql",
            [
              "--no-psqlrc",
              "--tuples-only",
              "--no-align",
              "--set=ON_ERROR_STOP=1",
              "--command",
              `SELECT coalesce(storage_object_key, '') || E'|' || coalesce(storage_staging_key, '') FROM enough.task_evidence_items WHERE id = '${evidenceId}'::uuid`,
            ],
            pgEnvironment(target.toString()),
          ).catch(() => "");
          const [storedObjectKey, storedStagingKey] = keys.split("|");
          objectKey ??= storedObjectKey || undefined;
          stagingKey = storedStagingKey || undefined;
          if (objectKey)
            await evidenceObjectStore()
              .delete(objectKey)
              .catch(() => undefined);
          if (stagingKey)
            await evidenceObjectStore()
              .delete(stagingKey)
              .catch(() => undefined);
          await run(
            "dropdb",
            ["--maintenance-db=postgres", databaseName],
            pgEnvironment(adminUrl, "postgres"),
          );
        }
        const [afterObjects, afterStaging] = await Promise.all([
          evidenceObjectStore().list({ prefix: "obj-", maxKeys: 100 }),
          evidenceObjectStore().list({ prefix: "stage-", maxKeys: 100 }),
        ]);
        for (const item of [...afterObjects.objects, ...afterStaging.objects]) {
          if (!knownKeys.has(item.key))
            await evidenceObjectStore()
              .delete(item.key)
              .catch(() => undefined);
        }
        await closeEvidenceObjectStore();
      }
    }, 120000);

    afterAll(async () => {
      await closeEvidenceObjectStore();
    });
  },
);
