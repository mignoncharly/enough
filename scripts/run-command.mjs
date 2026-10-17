import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { commandEnvironment } from "./subprocess-environment.mjs";

const argv = process.argv.slice(2);
const mode = argv.shift();
const [command, ...args] = argv;
if (!command)
  throw new Error("Usage: run-command.mjs <--clean|--test|--build|--runtime> <command> [args...]");

if (mode !== "--runtime") {
  // A release checkout must not reload credentials from dotenv after sanitization.
  for (const directory of [".", "apps/web"]) {
    const target = path.resolve(directory);
    if (!existsSync(target)) continue;
    for (const file of readdirSync(target)) {
      if (/^\.env(?:\.|$)/i.test(file) && file !== ".env.example") {
        throw new Error(
          "Isolated release commands require a checkout without dotenv credential files",
        );
      }
    }
  }
}
const childEnvironment = commandEnvironment(process.env, mode);

const child = spawn(command, args, { stdio: "inherit", env: childEnvironment });
child.once("error", (error) => {
  console.error(`Could not start ${command}:`, error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
