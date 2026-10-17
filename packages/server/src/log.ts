import pino from "pino";

/** Structured JSON logs (pretty-printing is left to the log shipper). Never log secrets. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.CV_SERVICE ?? "web" },
  redact: { paths: ["password", "*.password", "token", "*.token", "secret", "*.secret", "headers.cookie"], censor: "[redacted]" },
});
