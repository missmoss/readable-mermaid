import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { generateChecksums } from "./generate-checksums.js";
import { generateLicenseInventory } from "./generate-license-inventory.js";

const execFileAsync = promisify(execFile);

export async function prepareReleaseArtifacts(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const releaseDir = options.releaseDir ?? path.join(repoRoot, "release");
  const npmCacheDir = path.join(repoRoot, ".npm-cache-release");

  await rm(releaseDir, { recursive: true, force: true });
  await rm(npmCacheDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  await mkdir(npmCacheDir, { recursive: true });

  const packageFileName = await generatePackageTarball(repoRoot, releaseDir, npmCacheDir);
  const sbomPath = await generateSbom(repoRoot, releaseDir, npmCacheDir);
  const { jsonPath: licenseJsonPath, markdownPath: licenseMarkdownPath, inventory } =
    await generateLicenseInventory({ repoRoot, outputDir: releaseDir });
  const manifestPath = await writeReleaseManifest({
    repoRoot,
    releaseDir,
    packageFileName,
    sbomPath,
    licenseJsonPath,
    licenseMarkdownPath,
    packageCount: inventory.length
  });
  const { sumsPath } = await generateChecksums(releaseDir);
  await rm(npmCacheDir, { recursive: true, force: true });

  return {
    releaseDir,
    packageTarballPath: path.join(releaseDir, packageFileName),
    sbomPath,
    licenseJsonPath,
    licenseMarkdownPath,
    manifestPath,
    sumsPath
  };
}

async function generatePackageTarball(repoRoot, releaseDir, npmCacheDir) {
  const { stdout } = await execFileAsync("npm", ["pack", "--json"], {
    cwd: repoRoot,
    env: buildNpmEnv(npmCacheDir)
  });
  const parsed = JSON.parse(stdout);
  const packageFileName = parsed[0]?.filename;

  if (!packageFileName) {
    throw new Error("npm pack did not return a tarball filename.");
  }

  const sourcePath = path.join(repoRoot, packageFileName);
  const targetPath = path.join(releaseDir, packageFileName);
  await rename(sourcePath, targetPath);

  return packageFileName;
}

async function generateSbom(repoRoot, releaseDir, npmCacheDir) {
  const { stdout } = await execFileAsync(
    "npm",
    ["sbom", "--omit=dev", "--sbom-format=cyclonedx"],
    { cwd: repoRoot, env: buildNpmEnv(npmCacheDir), maxBuffer: 20 * 1024 * 1024 }
  );
  const sbomPath = path.join(releaseDir, "sbom.cyclonedx.json");
  await writeFile(sbomPath, stdout, "utf8");
  return sbomPath;
}

async function writeReleaseManifest({
  repoRoot,
  releaseDir,
  packageFileName,
  sbomPath,
  licenseJsonPath,
  licenseMarkdownPath,
  packageCount
}) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const manifestPath = path.join(releaseDir, "manifest.json");
  const manifest = {
    name: packageJson.name,
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    artifacts: {
      packageTarball: packageFileName,
      sbom: path.relative(releaseDir, sbomPath),
      licenseInventoryJson: path.relative(releaseDir, licenseJsonPath),
      licenseInventoryMarkdown: path.relative(releaseDir, licenseMarkdownPath),
      checksums: "SHA256SUMS"
    },
    runtimeDependencyCount: packageCount
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function buildNpmEnv(npmCacheDir) {
  return {
    ...process.env,
    npm_config_cache: npmCacheDir
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await prepareReleaseArtifacts();
  console.log(result.packageTarballPath);
  console.log(result.sbomPath);
  console.log(result.licenseJsonPath);
  console.log(result.licenseMarkdownPath);
  console.log(result.manifestPath);
  console.log(result.sumsPath);
}
