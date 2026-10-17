export function requestLoggerOptions(level: string) {
  return {
    level,
    redact: {
      paths: [
        "req.url",
        "req.query",
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-enough-signature",
        "req.headers.stripe-signature",
      ],
      censor: "[REDACTED]",
    },
  };
}
