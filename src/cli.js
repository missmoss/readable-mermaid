#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveChromeExecutable } from "./browser.js";
import { EXIT_CODES, ReadableMermaidError, getExitCode } from "./errors.js";
import { SCREEN_READABLE_PROFILE } from "./profile.js";
import { renderDocInlineDiagram } from "./render.js";

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function usage() {
  return [
    "Usage: readable-mermaid <diagram.mmd>",
    "",
    "Exit codes:",
    `  ${EXIT_CODES.USAGE} invalid CLI usage`,
    `  ${EXIT_CODES.PATH_BOUNDARY} input or output path is outside the current working directory`,
    `  ${EXIT_CODES.UNSUPPORTED_DIAGRAM} diagram type is not supported`,
    `  ${EXIT_CODES.UNSUPPORTED_SYNTAX} Mermaid sequence syntax is not supported`,
    `  ${EXIT_CODES.BROWSER_NOT_FOUND} no supported local browser binary was found`,
    `  ${EXIT_CODES.RENDER_FAILURE} render failed`
  ].join("\n");
}

function buildOutputPaths(outputDir, baseName, outputSuffix) {
  return {
    pngPath: path.join(outputDir, `${baseName}.${outputSuffix}.png`),
    svgPath: path.join(outputDir, `${baseName}.${outputSuffix}.svg`)
  };
}

export function resolveOutputDir(inputFilePath, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());

  if (options.outputDir) {
    return path.resolve(workspaceRoot, options.outputDir);
  }

  return path.dirname(inputFilePath);
}

export async function renderInputFile(inputPath, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const absoluteInputPath = path.resolve(workspaceRoot, inputPath);
  const realWorkspaceRoot = await realpath(workspaceRoot);
  const realInputPath = await realpath(absoluteInputPath);
  const outputDir = resolveOutputDir(realInputPath, options);

  if (!isPathInside(realWorkspaceRoot, realInputPath)) {
    throw new ReadableMermaidError(
      `Input path must stay inside the current working directory: ${inputPath}`,
      {
        code: "PATH_BOUNDARY",
        exitCode: EXIT_CODES.PATH_BOUNDARY
      }
    );
  }

  if (!isPathInside(workspaceRoot, outputDir)) {
    throw new ReadableMermaidError(
      `Output directory must stay inside the current working directory: ${outputDir}`,
      {
        code: "PATH_BOUNDARY",
        exitCode: EXIT_CODES.PATH_BOUNDARY
      }
    );
  }

  const source = await readFile(realInputPath, "utf8");
  const selectedProfile = SCREEN_READABLE_PROFILE;
  const chromeExecutablePath = await resolveChromeExecutable(selectedProfile.chromeExecutableCandidates);
  const result = await renderDocInlineDiagram(source, {
    ...selectedProfile,
    chromeExecutablePath
  });
  const baseName = path.basename(realInputPath, path.extname(realInputPath));

  await mkdir(outputDir, { recursive: true });

  const outputSuffix = selectedProfile.name;
  const { pngPath, svgPath } = buildOutputPaths(outputDir, baseName, outputSuffix);
  await writeFile(svgPath, result.svg, "utf8");
  await writeFile(pngPath, result.png);

  return {
    svgPath,
    pngPath
  };
}

export async function main(args = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;

  if (args.includes("--help")) {
    stdout(usage());
    return EXIT_CODES.SUCCESS;
  }

  const unsupportedFlags = args.filter((arg) => arg.startsWith("-"));
  if (unsupportedFlags.length > 0) {
    stderr(`Unsupported option: ${unsupportedFlags[0]}`);
    stderr(usage());
    return EXIT_CODES.USAGE;
  }

  const positionalArgs = args;
  const inputPath = positionalArgs[0];

  if (!inputPath) {
    stderr(usage());
    return EXIT_CODES.USAGE;
  }

  try {
    const { svgPath, pngPath } = await renderInputFile(inputPath);
    stdout(svgPath);
    stdout(pngPath);
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return getExitCode(error);
  }
}

export function isCliEntrypoint(argv1 = process.argv[1]) {
  if (!argv1) {
    return false;
  }

  try {
    return realpathSync(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return path.resolve(argv1) === fileURLToPath(import.meta.url);
  }
}

if (isCliEntrypoint()) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
