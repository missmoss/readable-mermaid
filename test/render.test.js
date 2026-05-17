import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { renderDocInlineDiagram } from "../src/render.js";
import { isCliEntrypoint, renderInputFile, main, resolveOutputDir } from "../src/cli.js";
import { EXIT_CODES } from "../src/errors.js";
import { parseSequenceDiagram } from "../src/sequence-renderer.js";

const execFileAsync = promisify(execFile);

test("renderDocInlineDiagram rejects unsupported non-sequence sources", async () => {
  await assert.rejects(
    renderDocInlineDiagram("flowchart LR\nA-->B\n", {}),
    (error) =>
      error.message.match(/Only Mermaid sequenceDiagram is supported/) &&
      error.exitCode === EXIT_CODES.UNSUPPORTED_DIAGRAM
  );
});

test("parseSequenceDiagram accepts the supported autonumber directive", () => {
  const parsed = parseSequenceDiagram([
    "sequenceDiagram",
    "  autonumber",
    "  participant A as Service A",
    "  A->>A: Ping"
  ].join("\n"));

  assert.equal(parsed.messageCount, 1);
  assert.equal(parsed.participants.length, 1);
});

test("parseSequenceDiagram rejects unsupported sequence syntax instead of dropping it", () => {
  assert.throws(
    () =>
      parseSequenceDiagram([
        "sequenceDiagram",
        "  participant A",
        "  rect rgb(200, 200, 255)",
        "  A->>A: Ping",
        "  end"
      ].join("\n")),
    (error) =>
      error.message.match(/Unsupported Mermaid sequence syntax at line 3/) &&
      error.exitCode === EXIT_CODES.UNSUPPORTED_SYNTAX
  );
});

test("renderInputFile rejects inputs outside the declared workspace root", async () => {
  const workspaceRoot = path.join(tmpdir(), `readable-mermaid-workspace-${process.pid}`);
  const outsideDir = path.join(tmpdir(), `readable-mermaid-outside-${process.pid}`);
  const outsideInputPath = path.join(outsideDir, "outside.mmd");

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(outsideInputPath, "sequenceDiagram\nA->>A: Ping\n", "utf8");

  await assert.rejects(
    renderInputFile(outsideInputPath, { workspaceRoot }),
    (error) =>
      error.message.match(/Input path must stay inside the current working directory/) &&
      error.exitCode === EXIT_CODES.PATH_BOUNDARY
  );
});

test("main returns a stable usage exit code for invalid CLI invocations", async () => {
  const stdout = [];
  const stderr = [];
  const exitCode = await main([], {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line)
  });

  assert.equal(exitCode, EXIT_CODES.USAGE);
  assert.equal(stdout.length, 0);
  assert.match(stderr.join("\n"), /Usage: readable-mermaid <diagram\.mmd>/);
});

test("resolveOutputDir defaults to the input file directory", () => {
  const resolved = resolveOutputDir("/tmp/workspace/diagrams/test.mmd");

  assert.equal(resolved, "/tmp/workspace/diagrams");
});

test("resolveOutputDir keeps explicit outputDir relative to the workspace root", () => {
  const resolved = resolveOutputDir("/tmp/workspace/diagrams/test.mmd", {
    workspaceRoot: "/tmp/workspace",
    outputDir: "dist"
  });

  assert.equal(resolved, "/tmp/workspace/dist");
});

test("isCliEntrypoint resolves symlinked cli paths used by npm bin shims", async () => {
  const fixtureDir = path.join(tmpdir(), `readable-mermaid-cli-entry-${process.pid}`);
  const symlinkPath = path.join(fixtureDir, "readable-mermaid");
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

  await mkdir(fixtureDir, { recursive: true });
  await symlink(cliPath, symlinkPath);

  assert.equal(isCliEntrypoint(symlinkPath), true);
});

test("symlinked cli invocation still executes main and prints help output", async () => {
  const fixtureDir = path.join(tmpdir(), `readable-mermaid-cli-help-${process.pid}`);
  const symlinkPath = path.join(fixtureDir, "readable-mermaid");
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

  await mkdir(fixtureDir, { recursive: true });
  await symlink(cliPath, symlinkPath);

  const { stdout, stderr } = await execFileAsync(process.execPath, [symlinkPath, "--help"]);

  assert.match(stdout, /Usage: readable-mermaid <diagram\.mmd>/);
  assert.equal(stderr, "");
});
