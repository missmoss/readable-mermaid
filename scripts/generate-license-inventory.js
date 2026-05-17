import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export async function generateLicenseInventory(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const outputDir = options.outputDir ?? path.join(repoRoot, "release");
  const packageLockPath = path.join(repoRoot, "package-lock.json");
  const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
  const packageEntries = Object.entries(packageLock.packages ?? {});
  const inventory = [];

  for (const [packagePath, lockMeta] of packageEntries) {
    if (!packagePath || !packagePath.startsWith("node_modules/") || lockMeta?.dev) {
      continue;
    }

    const packageJsonPath = path.join(repoRoot, packagePath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    inventory.push({
      name: packageJson.name,
      version: packageJson.version,
      license: packageJson.license ?? "UNKNOWN",
      description: packageJson.description ?? "",
      homepage: packageJson.homepage ?? "",
      repository: normalizeRepository(packageJson.repository),
      path: packagePath,
      integrity: lockMeta.integrity ?? "",
      resolved: lockMeta.resolved ?? ""
    });
  }

  inventory.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }

    return left.version.localeCompare(right.version);
  });

  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "license-inventory.json");
  const markdownPath = path.join(outputDir, "license-inventory.md");

  await writeFile(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, toMarkdown(inventory), "utf8");

  return {
    inventory,
    jsonPath,
    markdownPath
  };
}

function normalizeRepository(repository) {
  if (!repository) {
    return "";
  }

  if (typeof repository === "string") {
    return repository;
  }

  return repository.url ?? "";
}

function toMarkdown(inventory) {
  const lines = [
    "# License Inventory",
    "",
    "| Package | Version | License | Homepage |",
    "| --- | --- | --- | --- |"
  ];

  for (const entry of inventory) {
    lines.push(
      `| ${entry.name} | ${entry.version} | ${entry.license} | ${entry.homepage || entry.repository || ""} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outputDirArg = process.argv[2];
  const result = await generateLicenseInventory({
    outputDir: outputDirArg ? path.resolve(process.cwd(), outputDirArg) : undefined
  });
  console.log(result.jsonPath);
  console.log(result.markdownPath);
}
