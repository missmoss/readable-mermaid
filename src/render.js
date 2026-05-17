import { renderSequenceDocInlineDiagram } from "./sequence-renderer.js";
import { EXIT_CODES, ReadableMermaidError } from "./errors.js";

export async function renderDocInlineDiagram(source, profile) {
  if (!/^\s*sequenceDiagram\b/im.test(source)) {
    throw new ReadableMermaidError("Only Mermaid sequenceDiagram is supported in this version.", {
      code: "UNSUPPORTED_DIAGRAM",
      exitCode: EXIT_CODES.UNSUPPORTED_DIAGRAM
    });
  }

  return renderSequenceDocInlineDiagram(source, profile);
}
