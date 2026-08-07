export const BACKEND_UNAVAILABLE_REPLY =
  "I can't reach my knowledge base at the moment, so I can't answer that right now. Please try again in a few minutes.";

// Supabase-js reports network failures in the returned error object rather than
// throwing, so DNS/connection problems arrive as an ordinary `error` value.
// These are infrastructure outages, not data errors: the bot should still reply.
export function isBackendUnreachable(error: unknown): boolean {
  if (!error) return false;

  // A resuming project answers through Cloudflare before Postgres accepts
  // connections, so the outage surfaces as a 5xx body rather than a DNS error.
  if (typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 500) return true;
  }

  const parts =
    error instanceof Error
      ? [error.message, error.stack, String(error.cause ?? "")]
      : typeof error === "object"
        ? Object.values(error as Record<string, unknown>).map((v) => String(v))
        : [String(error)];

  const blob = parts.join(" ").toLowerCase();

  return (
    blob.includes("fetch failed") ||
    blob.includes("getaddrinfo") ||
    blob.includes("enotfound") ||
    blob.includes("econnrefused") ||
    blob.includes("econnreset") ||
    blob.includes("etimedout") ||
    blob.includes("connection was refused") ||
    blob.includes("origin_down") ||
    blob.includes("web server is down") ||
    blob.includes("network")
  );
}
