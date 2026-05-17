import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { renderSampleArtifacts } from "./render-sample-artifacts.js";

const repoRoot = process.cwd();
const samplesDir = path.join(repoRoot, "samples");
const baselineDir = path.join(samplesDir, "dist");
const sampleFiles = (await readdir(samplesDir))
  .filter((name) => name.endsWith(".mmd"))
  .sort();

if (sampleFiles.length === 0) {
  throw new Error("No sample .mmd files found in ./samples.");
}

const regressionDir = await mkdtemp(path.join(tmpdir(), "readable-mermaid-regression-"));

try {
  await renderSampleArtifacts({
    repoRoot,
    outputDir: regressionDir
  });

  for (const sampleFile of sampleFiles) {
    const baseName = path.basename(sampleFile, ".mmd");
    const expectedSvgPath = path.join(baselineDir, `${baseName}.screen-readable.svg`);
    const expectedPngPath = path.join(baselineDir, `${baseName}.screen-readable.png`);
    const actualSvgPath = path.join(regressionDir, `${baseName}.screen-readable.svg`);

    await access(expectedSvgPath, constants.F_OK);
    await access(expectedPngPath, constants.F_OK);
    await access(actualSvgPath, constants.F_OK);

    const [expectedSvg, actualSvg] = await Promise.all([
      readFile(expectedSvgPath, "utf8"),
      readFile(actualSvgPath, "utf8")
    ]);

    if (expectedSvg !== actualSvg) {
      throw new Error(`SVG regression mismatch for ${baseName}.`);
    }
  }
} finally {
  await rm(regressionDir, { recursive: true, force: true });
}

console.log(
  `Rendered and matched ${sampleFiles.length} sample SVG baselines; verified matching PNG baselines exist.`
);
