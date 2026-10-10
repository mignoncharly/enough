import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.ENOUGH_PHASE6_INTEGRATION !== "1")(
  "Phase 6 tool classification on disposable PostgreSQL, Redis, API, and web proxy",
  () => {
    let pool: typeof import("@enough/db").pool;
    const ids: string[] = [];
    const api = "http://127.0.0.1:4410";
    const web = "http://127.0.0.1:3306";

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
      expect([target.hostname, target.port, target.pathname, target.username]).toEqual([
        "127.0.0.1",
        "55437",
        "/enough_phase6",
        "enough_phase6",
      ]);
      expect(process.env.REDIS_URL).toBe("redis://127.0.0.1:56389/0");
      expect(process.env.APP_BASE_URL).toBe(web);
      expect(process.env.API_BASE_URL).toBe(api);
      ({ pool } = await import("@enough/db"));
      const identity = await pool.query("SELECT current_user, current_database()");
      expect(identity.rows[0]).toEqual({
        current_user: "enough_phase6",
        current_database: "enough_phase6",
      });
      const migrations = await pool.query<{ id: string }>(
        "SELECT id FROM enough.schema_migrations ORDER BY id",
      );
      expect(migrations.rows).toHaveLength(15);
      expect(migrations.rows.slice(0, 6).map((row) => row.id)).toEqual([
        "0001_create_enough_schema.sql",
        "0002_authentication.sql",
        "0003_product_onboarding.sql",
        "0004_product_stage_engine.sql",
        "0005_activity_event_platform.sql",
        "0006_tool_classification.sql",
      ]);
      const catalog = await pool.query<{ tool_kind: string; count: number }>(
        `SELECT tool_kind, count(*)::int AS count
         FROM enough.tool_classification_catalog GROUP BY tool_kind ORDER BY tool_kind`,
      );
      expect(catalog.rows).toEqual([
        { tool_kind: "APPLICATION", count: 11 },
        { tool_kind: "DOMAIN", count: 18 },
      ]);
    });

    afterAll(async () => {
      if (!pool) return;
      await pool.query("DELETE FROM enough.auth_audit_events WHERE user_id = ANY($1::uuid[])", [
        ids,
      ]);
      await pool.query("DELETE FROM enough.auth_users WHERE id = ANY($1::uuid[])", [ids]);
      await pool.end();
    });

    async function account() {
      const id = randomUUID();
      const email = `phase6-${id}@example.test`;
      ids.push(id);
      await pool.query(
        "INSERT INTO enough.auth_users (id, email, email_normalized, email_verified_at) VALUES ($1, $2, $2, now())",
        [id, email],
      );
      const { createSession } = await import("../../../packages/auth/src/session.js");
      const session = await createSession(id, "web", "Phase 6 synthetic test", "magic_link");
      return {
        id,
        email,
        headers: {
          cookie: `enough_session=${session.token}; enough_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken ?? "",
          origin: web,
          "content-type": "application/json",
        },
      };
    }

    type Account = Awaited<ReturnType<typeof account>>;

    function request(path: string, user?: Account, body?: unknown, method?: string) {
      return fetch(`${web}/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: user?.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    }

    async function payload(response: Response, status = 200) {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return response.json();
    }

    async function product(user: Account, name = `Phase 6 product ${randomUUID()}`) {
      const response = await request("/products", user, {
        name,
        productStage: "IDEA",
        targetCustomer: "Synthetic test teams",
        problemStatement: "Verify classification mappings",
        initialGoal: "Validate tool mapping behavior",
      });
      const result = await payload(response, 201);
      return result.product.id as string;
    }

    async function createMapping(user: Account, body: Record<string, unknown>) {
      return payload(await request("/classification/mappings", user, body), 201);
    }

    async function resolve(user: Account, body: Record<string, unknown>) {
      return payload(await request("/classification/resolve", user, body));
    }

    it("applies migrations 0002–0006 and exposes the seeded catalog behind authentication", async () => {
      expect((await request("/classification/catalog")).status).toBe(401);
      expect((await request("/classification/mappings")).status).toBe(401);
      const user = await account();
      const result = await payload(await request("/classification/catalog", user));
      expect(result.catalog).toHaveLength(29);
      expect(result.catalog).toContainEqual({
        toolKind: "APPLICATION",
        toolKey: "com.microsoft.vscode",
        displayName: "Visual Studio Code",
        classification: "BUILD",
      });
      expect(result.catalog).toContainEqual({
        toolKind: "DOMAIN",
        toolKey: "figma.com",
        displayName: "Figma",
        classification: "BUILD",
      });
      const filtered = await payload(
        await request("/classification/catalog?kind=APPLICATION&q=visual%20studio", user),
      );
      expect(filtered.catalog).toHaveLength(1);
      expect(filtered.catalog[0].toolKey).toBe("com.microsoft.vscode");

      const labels = ["BUILD", "GROWTH", "NEUTRAL", "CONTEXTUAL", "BLOCKED", "ALLOWED"];
      for (const classification of labels) {
        const mapping = await createMapping(user, {
          toolKind: "APPLICATION",
          toolKey: ` COM.Example.Phase6-${classification} `,
          displayName: `Phase 6 ${classification}`,
          classification,
          productId: null,
        });
        expect(mapping.mapping.classification).toBe(classification);
      }
      const mappings = await payload(await request("/classification/mappings", user));
      expect(mappings.mappings).toHaveLength(labels.length);
      expect(
        mappings.mappings.map((mapping: { classification: string }) => mapping.classification),
      ).toEqual(expect.arrayContaining(labels));
    });

    it("normalizes custom application/domain keys and enforces context-aware duplicate uniqueness", async () => {
      const user = await account();
      const appMapping = await createMapping(user, {
        toolKind: "APPLICATION",
        toolKey: "  Com.Example.Editor.EXE  ",
        displayName: "Synthetic Editor",
        classification: "BUILD",
        productId: null,
      });
      expect(appMapping.mapping.toolKey).toBe("com.example.editor.exe");

      const domainMapping = await createMapping(user, {
        toolKind: "DOMAIN",
        toolKey: "*.Work.Example.Test",
        displayName: "Work Example",
        classification: "GROWTH",
        productId: null,
        contextKey: "Purpose",
        contextValue: "Client Project",
      });
      expect(domainMapping.mapping).toMatchObject({
        toolKey: "*.work.example.test",
        contextKey: "purpose",
        contextValue: "client project",
      });

      const duplicate = await request("/classification/mappings", user, {
        toolKind: "DOMAIN",
        toolKey: "*.WORK.EXAMPLE.TEST",
        displayName: "Duplicate",
        classification: "BLOCKED",
        productId: null,
        contextKey: "PURPOSE",
        contextValue: "CLIENT PROJECT",
      });
      expect(duplicate.status).toBe(409);

      const invalidDomain = await request("/classification/mappings", user, {
        toolKind: "DOMAIN",
        toolKey: "javascript:alert(1)",
        displayName: "Invalid",
        classification: "BUILD",
      });
      expect(invalidDomain.status).toBe(400);
      const incompleteContext = await request("/classification/mappings", user, {
        toolKind: "APPLICATION",
        toolKey: "com.example.context",
        displayName: "Incomplete context",
        classification: "BUILD",
        contextKey: "purpose",
      });
      expect(incompleteContext.status).toBe(400);
    });

    it("resolves product, context, specificity, catalog, and unknown keys deterministically", async () => {
      const user = await account();
      const productId = await product(user, "Phase 6 resolver product");
      const otherProductId = await product(user, "Phase 6 other resolver product");
      await createMapping(user, {
        toolKind: "DOMAIN",
        toolKey: "*.resolution.example.test",
        displayName: "Account wildcard",
        classification: "GROWTH",
        productId: null,
      });
      await createMapping(user, {
        toolKind: "DOMAIN",
        toolKey: "app.resolution.example.test",
        displayName: "Account exact",
        classification: "ALLOWED",
        productId: null,
      });
      await createMapping(user, {
        toolKind: "DOMAIN",
        toolKey: "*.resolution.example.test",
        displayName: "Product wildcard",
        classification: "BLOCKED",
        productId,
      });
      await createMapping(user, {
        toolKind: "DOMAIN",
        toolKey: "*.resolution.example.test",
        displayName: "Client context",
        classification: "BUILD",
        productId,
        contextKey: "purpose",
        contextValue: "client",
      });
      await createMapping(user, {
        toolKind: "DOMAIN",
        toolKey: "figma.com",
        displayName: "My Figma label",
        classification: "CONTEXTUAL",
        productId: null,
      });

      const contextual = await resolve(user, {
        toolKind: "DOMAIN",
        toolKey: "APP.Resolution.Example.Test.",
        productId,
        contextKey: "PURPOSE",
        contextValue: "Client",
      });
      expect(contextual.resolution).toMatchObject({
        classification: "BUILD",
        source: "PRODUCT_MAPPING",
        matchedKey: "*.resolution.example.test",
        contextMatched: true,
      });

      const productScope = await resolve(user, {
        toolKind: "DOMAIN",
        toolKey: "app.resolution.example.test",
        productId,
      });
      expect(productScope.resolution).toMatchObject({
        classification: "BLOCKED",
        source: "PRODUCT_MAPPING",
      });

      const exactAccount = await resolve(user, {
        toolKind: "DOMAIN",
        toolKey: "app.resolution.example.test",
      });
      expect(exactAccount.resolution).toMatchObject({
        classification: "ALLOWED",
        source: "ACCOUNT_MAPPING",
        matchedKey: "app.resolution.example.test",
      });

      const wildcardAccount = await resolve(user, {
        toolKind: "DOMAIN",
        toolKey: "another.resolution.example.test",
      });
      expect(wildcardAccount.resolution).toMatchObject({
        classification: "GROWTH",
        source: "ACCOUNT_MAPPING",
        matchedKey: "*.resolution.example.test",
      });

      const catalog = await resolve(user, {
        toolKind: "DOMAIN",
        toolKey: "figma.com",
        productId: otherProductId,
      });
      expect(catalog.resolution).toMatchObject({
        classification: "CONTEXTUAL",
        source: "ACCOUNT_MAPPING",
      });
      const defaultCatalog = await resolve(user, {
        toolKind: "DOMAIN",
        toolKey: "github.com",
        productId: otherProductId,
      });
      expect(defaultCatalog.resolution).toMatchObject({
        classification: "BUILD",
        source: "CATALOG",
      });

      const unknown = await resolve(user, {
        toolKind: "APPLICATION",
        toolKey: "org.example.untracked-tool",
        productId: otherProductId,
      });
      expect(unknown.resolution).toMatchObject({
        classification: "NEUTRAL",
        source: "FALLBACK",
        matchedKey: null,
      });
    });

    it("enforces owner isolation on product mappings and CRUD while ignoring forged ownership fields", async () => {
      const owner = await account();
      const other = await account();
      const ownerProductId = await product(owner, "Phase 6 owned product");
      const otherProductId = await product(other, "Phase 6 other-owned product");
      const missingCsrf = await fetch(`${web}/api/classification/mappings`, {
        method: "POST",
        headers: {
          cookie: owner.headers.cookie,
          origin: web,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          toolKind: "APPLICATION",
          toolKey: "com.example.no-csrf",
          displayName: "Missing CSRF",
          classification: "BUILD",
        }),
      });
      expect(missingCsrf.status).toBe(403);
      const created = await createMapping(owner, {
        userId: other.id,
        toolKind: "APPLICATION",
        toolKey: "Com.Example.Private-App",
        displayName: "Owner private app",
        classification: "BUILD",
        productId: ownerProductId,
      });
      const mappingId = created.mapping.id as string;
      expect(created.mapping).toMatchObject({
        toolKey: "com.example.private-app",
        productId: ownerProductId,
      });
      const ownerRow = await pool.query<{ user_id: string }>(
        "SELECT user_id FROM enough.tool_classification_mappings WHERE id = $1",
        [mappingId],
      );
      expect(ownerRow.rows[0].user_id).toBe(owner.id);

      const otherMappings = await payload(await request("/classification/mappings", other));
      expect(otherMappings.mappings).toEqual([]);
      const foreignUpdate = await request(
        `/classification/mappings/${mappingId}`,
        other,
        {
          toolKind: "APPLICATION",
          toolKey: "com.example.changed",
          displayName: "Unauthorized change",
          classification: "BLOCKED",
          productId: null,
        },
        "PATCH",
      );
      expect(foreignUpdate.status).toBe(404);
      const foreignDelete = await request(
        `/classification/mappings/${mappingId}`,
        other,
        {},
        "DELETE",
      );
      expect(foreignDelete.status).toBe(404);

      const foreignProduct = await request("/classification/mappings", owner, {
        toolKind: "APPLICATION",
        toolKey: "com.example.foreign-product",
        displayName: "Foreign product",
        classification: "BUILD",
        productId: otherProductId,
      });
      expect(foreignProduct.status).toBe(404);
      const foreignResolution = await request("/classification/resolve", owner, {
        toolKind: "APPLICATION",
        toolKey: "com.example.private-app",
        productId: otherProductId,
      });
      expect(foreignResolution.status).toBe(404);

      const updated = await payload(
        await request(
          `/classification/mappings/${mappingId}`,
          owner,
          {
            toolKind: "APPLICATION",
            toolKey: "COM.EXAMPLE.PRIVATE-APP",
            displayName: "Updated private app",
            classification: "GROWTH",
            productId: ownerProductId,
          },
          "PATCH",
        ),
      );
      expect(updated.mapping).toMatchObject({
        id: mappingId,
        displayName: "Updated private app",
        classification: "GROWTH",
      });
      expect((await payload(await request("/classification/mappings", other))).mappings).toEqual(
        [],
      );
    });

    it("exports mappings and cascades them on product and account deletion", async () => {
      const owner = await account();
      const other = await account();
      const productId = await product(owner, "Phase 6 deletion product");
      await createMapping(owner, {
        toolKind: "DOMAIN",
        toolKey: "*.delete.example.test",
        displayName: "Product deletion mapping",
        classification: "BUILD",
        productId,
      });
      await createMapping(owner, {
        toolKind: "APPLICATION",
        toolKey: "com.example.account-level",
        displayName: "Account mapping",
        classification: "NEUTRAL",
        productId: null,
      });
      await createMapping(other, {
        toolKind: "APPLICATION",
        toolKey: "com.example.other-account",
        displayName: "Other account mapping",
        classification: "GROWTH",
        productId: null,
      });

      const exported = await payload(await request("/auth/account/export", owner));
      expect(exported.toolClassificationMappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tool_key: "*.delete.example.test",
            product_id: productId,
          }),
          expect.objectContaining({
            tool_key: "com.example.account-level",
            product_id: null,
          }),
        ]),
      );
      const otherExport = await payload(await request("/auth/account/export", other));
      expect(
        otherExport.toolClassificationMappings.map(
          (mapping: { tool_key: string }) => mapping.tool_key,
        ),
      ).toEqual(["com.example.other-account"]);

      const productDelete = await pool.query(
        "DELETE FROM enough.products WHERE id = $1 AND user_id = $2",
        [productId, owner.id],
      );
      expect(productDelete.rowCount).toBe(1);
      const ownerMappingsAfterProductDelete = await pool.query<{ tool_key: string }>(
        "SELECT tool_key FROM enough.tool_classification_mappings WHERE user_id = $1 ORDER BY tool_key",
        [owner.id],
      );
      expect(ownerMappingsAfterProductDelete.rows).toEqual([
        { tool_key: "com.example.account-level" },
      ]);

      const accountDelete = await request(
        "/auth/account",
        owner,
        { confirmationEmail: owner.email },
        "DELETE",
      );
      expect(accountDelete.status).toBe(204);
      const deletedMappings = await pool.query(
        "SELECT id FROM enough.tool_classification_mappings WHERE user_id = $1",
        [owner.id],
      );
      expect(deletedMappings.rows).toEqual([]);
      const otherMappings = await pool.query<{ tool_key: string }>(
        "SELECT tool_key FROM enough.tool_classification_mappings WHERE user_id = $1",
        [other.id],
      );
      expect(otherMappings.rows).toEqual([{ tool_key: "com.example.other-account" }]);
    });
  },
);
