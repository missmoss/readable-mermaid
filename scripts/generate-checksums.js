import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export async function generateChecksums(targetDir = path.join(process.cwd(), "release")) {
  const files = await collectFiles(targetDir);
  const entries = [];

  for (const filePath of files) {
    if (path.basename(filePath) === "SHA256SUMS") {
      continue;
    }

    const content = await readFile(filePath);
    const digest = createHash("sha256").update(content).digest("hex");
    entries.push({
      relativePath: path.relative(targetDir, filePath),
      sha256: digest
    });
  }

  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const sumsPath = path.join(targetDir, "SHA256SUMS");
  const body = entries.map((entry) => `${entry.sha256}  ${entry.relativePath}`).join("\n");
  await writeFile(sumsPath, `${body}\n`, "utf8");

  return {
    entries,
    sumsPath
  };
}

async function collectFiles(dirPath) {
  const dirEntries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of dirEntries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    const entryStats = await stat(fullPath);
    if (entryStats.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const targetDir = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(process.cwd(), "release");
  const result = await generateChecksums(targetDir);
  console.log(result.sumsPath);
}
