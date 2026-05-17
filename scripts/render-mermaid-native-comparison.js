import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import puppeteer from "puppeteer-core";

import {
  buildChromeLaunchArgs,
  createTemporaryBrowserProfile,
  removeTemporaryBrowserProfile,
  resolveChromeExecutable
} from "../src/browser.js";
import { SCREEN_READABLE_PROFILE } from "../src/profile.js";

const require = createRequire(import.meta.url);
const mermaidBundlePath = require.resolve("mermaid/dist/mermaid.min.js");

const repoRoot = process.cwd();
const sampleNames = process.argv.slice(2);

if (sampleNames.length === 0) {
  throw new Error("Usage: node ./scripts/render-mermaid-native-comparison.js <sample-name> [...]");
}

const chromeExecutablePath = await resolveChromeExecutable(SCREEN_READABLE_PROFILE.chromeExecutableCandidates);
const profileDir = await createTemporaryBrowserProfile();
const browser = await puppeteer.launch({
  executablePath: chromeExecutablePath,
  headless: true,
  args: buildChromeLaunchArgs(profileDir)
});

try {
  const page = await browser.newPage();
  await page.setViewport({
    width: 2240,
    height: 2000,
    deviceScaleFactor: 1
  });

  for (const sampleName of sampleNames) {
    await renderSample(page, sampleName);
  }
} finally {
  await browser.close().catch(() => {});
  await removeTemporaryBrowserProfile(profileDir);
}

async function renderSample(page, sampleName) {
  const inputPath = path.join(repoRoot, "samples", `${sampleName}.mmd`);
  const outputDir = path.join(repoRoot, "docs", "assets", "comparisons");
  const source = await readFile(inputPath, "utf8");

  await mkdir(outputDir, { recursive: true });
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
          }

          body {
            display: inline-block;
          }

          #mount {
            display: inline-block;
            padding: 24px;
            background: #ffffff;
          }

          #mount svg {
            display: block;
            max-width: none;
          }
        </style>
      </head>
      <body>
        <div id="mount"></div>
      </body>
    </html>
  `);

  await page.addScriptTag({ path: mermaidBundlePath });
  const svg = await page.evaluate(async (diagramSource) => {
    const renderId = `mermaid-native-${Math.random().toString(36).slice(2)}`;
    const mermaidApi = window.mermaid;
    mermaidApi.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
      themeVariables: {
        background: "#ffffff",
        mainBkg: "#ffffff",
        secondBkg: "#ffffff",
        tertiaryColor: "#ffffff"
      },
      sequence: {
        useMaxWidth: false
      }
    });

    const { svg: renderedSvg } = await mermaidApi.render(renderId, diagramSource);
    const mount = document.getElementById("mount");
    mount.innerHTML = renderedSvg;
    const svgElement = mount.querySelector("svg");
    if (!svgElement) {
      throw new Error("Mermaid did not render an SVG.");
    }

    svgElement.removeAttribute("max-width");
    svgElement.style.maxWidth = "none";
    svgElement.style.width = "100%";
    svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const box = svgElement.getBBox();
    const width = Math.ceil(box.width + box.x + 24);
    const height = Math.ceil(box.height + box.y + 24);
    svgElement.setAttribute("width", String(width));
    svgElement.setAttribute("height", String(height));
    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const backgroundRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    backgroundRect.setAttribute("x", "0");
    backgroundRect.setAttribute("y", "0");
    backgroundRect.setAttribute("width", String(width));
    backgroundRect.setAttribute("height", String(height));
    backgroundRect.setAttribute("fill", "#ffffff");
    svgElement.insertBefore(backgroundRect, svgElement.firstChild);

    return svgElement.outerHTML;
  }, source);

  const svgPath = path.join(outputDir, `${sampleName}.mermaid-native.svg`);
  const pngPath = path.join(outputDir, `${sampleName}.mermaid-native.png`);
  await writeFile(svgPath, `${svg}\n`, "utf8");

  const mount = await page.$("#mount");
  if (!mount) {
    throw new Error("Unable to find Mermaid render mount.");
  }

  const png = await mount.screenshot({ type: "png" });
  await writeFile(pngPath, png);

  console.log(svgPath);
  console.log(pngPath);
}
