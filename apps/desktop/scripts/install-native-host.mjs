import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostName = "com.enough.agent";
const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "resources",
  "native-host.cjs",
);
const args = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const [key, ...parts] = value.replace(/^--/, "").split("=");
    return [key, parts.join("=")];
  }),
);
const home = os.homedir();
const selected = (args.browser || "all").toLowerCase();
const validBrowsers = new Set(["chrome", "edge", "brave", "firefox", "all"]);
if (!validBrowsers.has(selected))
  throw new Error("Choose chrome, edge, brave, firefox, or all for --browser.");
const selectedNames = selected === "all" ? ["chrome", "edge", "brave", "firefox"] : [selected];
const browserDirs = {
  chrome: path.join(
    home,
    "AppData",
    "Local",
    "Google",
    "Chrome",
    "User Data",
    "NativeMessagingHosts",
  ),
  edge: path.join(
    home,
    "AppData",
    "Local",
    "Microsoft",
    "Edge",
    "User Data",
    "NativeMessagingHosts",
  ),
  brave: path.join(
    home,
    "AppData",
    "Local",
    "BraveSoftware",
    "Brave-Browser",
    "User Data",
    "NativeMessagingHosts",
  ),
  firefox: path.join(home, "AppData", "Roaming", "Mozilla", "NativeMessagingHosts"),
};

function allowedBrowserKeys(browser) {
  const origins = [args["chrome-origin"], args["edge-origin"], args["brave-origin"]].filter(
    Boolean,
  );
  const extensions = [args["firefox-id"] || "enough@example.com"];
  if (browser !== "firefox" && origins.length === 0) {
    throw new Error(
      "Pass the exact extension origin for the selected Chromium browser, such as --chrome-origin=chrome-extension://<id>/.",
    );
  }
  if (process.platform === "win32") return { origins, extensions };
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    browserDirs.chrome = path.join(support, "Google", "Chrome", "NativeMessagingHosts");
    browserDirs.edge = path.join(support, "Microsoft Edge", "NativeMessagingHosts");
    browserDirs.brave = path.join(
      support,
      "BraveSoftware",
      "Brave-Browser",
      "NativeMessagingHosts",
    );
    browserDirs.firefox = path.join(support, "Mozilla", "NativeMessagingHosts");
  } else {
    const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    browserDirs.chrome = path.join(config, "google-chrome", "NativeMessagingHosts");
    browserDirs.edge = path.join(config, "microsoft-edge", "NativeMessagingHosts");
    browserDirs.brave = path.join(config, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts");
    browserDirs.firefox = path.join(home, ".mozilla", "native-messaging-hosts");
  }
  return { origins, extensions };
}

const { origins, extensions } = allowedBrowserKeys(selected === "firefox" ? "firefox" : "chromium");
for (const name of selectedNames) {
  const directory = browserDirs[name];
  if (!directory) throw new Error("Choose chrome, edge, brave, firefox, or all for --browser.");
  const filename = path.join(directory, `${hostName}.json`);
  await mkdir(directory, { recursive: true });
  const manifest = {
    name: hostName,
    description: "Enough desktop agent status bridge",
    path: process.execPath,
    args: [scriptPath],
    type: "stdio",
    ...(name === "firefox"
      ? { allowed_extensions: extensions }
      : {
          allowed_origins: origins.map((origin) => {
            if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin))
              throw new Error(`Invalid extension origin: ${origin}`);
            return origin;
          }),
        }),
  };
  await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform === "win32") {
    const registryKey = {
      chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
      edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
      brave: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
      firefox: "HKCU\\Software\\Mozilla\\NativeMessagingHosts",
    }[name];
    execFileSync(
      "reg.exe",
      ["add", `${registryKey}\\${hostName}`, "/ve", "/t", "REG_SZ", "/d", filename, "/f"],
      { stdio: "ignore" },
    );
  }
}

console.log(
  `Installed ${hostName} for ${selectedNames.join(", ")}. Restart those browsers to connect.`,
);
