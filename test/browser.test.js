import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  buildChromeLaunchArgs,
  createTemporaryBrowserProfile,
  isLocalBrowserRequest,
  removeTemporaryBrowserProfile,
  resolveChromeExecutable
} from "../src/browser.js";

test("resolveChromeExecutable returns the first executable candidate", async () => {
  const fixtureDir = path.join(tmpdir(), `readable-mermaid-browser-${process.pid}-ok`);
  const missingPath = path.join(fixtureDir, "missing-browser");
  const browserPath = path.join(fixtureDir, "fake-browser");

  await mkdir(fixtureDir, { recursive: true });
  await writeFile(browserPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(browserPath, 0o755);

  const resolved = await resolveChromeExecutable([missingPath, browserPath]);
  assert.equal(resolved, browserPath);
});

test("resolveChromeExecutable throws when no candidates are executable", async () => {
  await assert.rejects(
    resolveChromeExecutable([
      "/tmp/readable-mermaid-does-not-exist-1",
      "/tmp/readable-mermaid-does-not-exist-2"
    ]),
    /No supported local browser binary found/
  );
});

test("isLocalBrowserRequest allows only local browser schemes", () => {
  assert.equal(isLocalBrowserRequest("about:blank"), true);
  assert.equal(isLocalBrowserRequest("data:text/plain,hello"), true);
  assert.equal(isLocalBrowserRequest("blob:https://example.com/id"), true);
  assert.equal(isLocalBrowserRequest("file:///tmp/test.svg"), true);
  assert.equal(isLocalBrowserRequest("http://example.com/diagram.svg"), false);
  assert.equal(isLocalBrowserRequest("https://example.com/diagram.svg"), false);
});

test("createTemporaryBrowserProfile creates a removable temporary directory", async () => {
  const profileDir = await createTemporaryBrowserProfile();
  const profileStats = await stat(profileDir);
  assert.equal(profileStats.isDirectory(), true);

  await removeTemporaryBrowserProfile(profileDir);

  await assert.rejects(stat(profileDir));
});

test("buildChromeLaunchArgs hardens browser startup and isolates profile data", () => {
  const profileDir = "/tmp/readable-mermaid-profile";
  const args = buildChromeLaunchArgs(profileDir);

  assert.deepEqual(args, [
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
    `--user-data-dir=${profileDir}`
  ]);
});
