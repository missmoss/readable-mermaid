export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC: 1,
  USAGE: 2,
  PATH_BOUNDARY: 3,
  UNSUPPORTED_DIAGRAM: 4,
  UNSUPPORTED_SYNTAX: 5,
  BROWSER_NOT_FOUND: 6,
  RENDER_FAILURE: 7
};

export class ReadableMermaidError extends Error {
  constructor(message, options = {}) {
    const { code = "RENDER_FAILURE", exitCode = EXIT_CODES.RENDER_FAILURE, cause } = options;
    super(message, cause ? { cause } : undefined);
    this.name = "ReadableMermaidError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function getExitCode(error) {
  if (error instanceof ReadableMermaidError) {
    return error.exitCode;
  }

  return EXIT_CODES.GENERIC;
}
