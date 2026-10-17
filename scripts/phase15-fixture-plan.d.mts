export const phase15Fixture: Readonly<{
  directory: string;
  markerFile: string;
  owner: string;
  markerVersion: number;
  database: string;
  role: string;
  host: string;
  ports: Readonly<{
    postgres: number;
    redis: number;
    wslRedis: number;
    api: number;
    worker: number;
    web: number;
  }>;
  migrationSteps: readonly string[];
  providerEnabledByDefault: false;
}>;
export function phase15MigrationFiles(): Promise<string[]>;
export function phase15Environment(
  source: NodeJS.ProcessEnv,
  credentials: { app: string; auth: string },
): NodeJS.ProcessEnv;
export function assertPhase15MigrationLedger(appliedIds: string[]): Promise<void>;
export function assertPhase15Ownership(input: {
  resolvedDirectory: string;
  symbolicLink: boolean;
  marker: unknown;
  activePorts: number[];
}): void;
