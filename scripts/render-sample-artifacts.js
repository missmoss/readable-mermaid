import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { SCREEN_READABLE_PROFILE } from "../src/profile.js";
import { renderSequenceSvgDocument } from "../src/sequence-renderer.js";

export async function renderSampleArtifacts(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const samplesDir = path.join(repoRoot, "samples");
  const outputDir = options.outputDir ?? path.join(samplesDir, "dist");
  const sampleFiles = (await readdir(samplesDir))
    .filter((name) => name.endsWith(".mmd"))
    .sort();

  if (sampleFiles.length === 0) {
    throw new Error("No sample .mmd files found in ./samples.");
  }

  await mkdir(outputDir, { recursive: true });

  for (const sampleFile of sampleFiles) {
    const baseName = path.basename(sampleFile, ".mmd");
    const sourcePath = path.join(samplesDir, sampleFile);
    const source = await readFile(sourcePath, "utf8");
    const { svg } = renderSequenceSvgDocument(source, SCREEN_READABLE_PROFILE);
    const svgPath = path.join(outputDir, `${baseName}.screen-readable.svg`);
    await writeFile(svgPath, svg, "utf8");
  }

  return { sampleCount: sampleFiles.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outputDirArg = process.argv[2];
  const result = await renderSampleArtifacts({
    outputDir: outputDirArg ? path.resolve(process.cwd(), outputDirArg) : undefined
  });
  console.log(`Rendered ${result.sampleCount} sample SVG baselines.`);
}
