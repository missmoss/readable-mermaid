import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXIT_CODES, ReadableMermaidError } from "./errors.js";

export async function resolveChromeExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new ReadableMermaidError(
    "No supported local browser binary found. Checked Google Chrome, Chromium, and Microsoft Edge in /Applications.",
    {
      code: "BROWSER_NOT_FOUND",
      exitCode: EXIT_CODES.BROWSER_NOT_FOUND
    }
  );
}

export function isLocalBrowserRequest(url) {
  return (
    url.startsWith("about:") ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:")
  );
}

export async function createTemporaryBrowserProfile() {
  return mkdtemp(path.join(tmpdir(), "readable-mermaid-chrome-"));
}

export async function removeTemporaryBrowserProfile(profileDir) {
  await rm(profileDir, { recursive: true, force: true });
}

export function buildChromeLaunchArgs(userDataDir) {
  return [
    "--allow-file-access-from-files",
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`
  ];
}
