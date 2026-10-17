type HeaderReader = { get(name: string): string | null };

/**
 * The caller's IP for guest rate limiting. A client can put anything at the front of X-Forwarded-For; each trusted
 * proxy appends the address it saw. On Cloud Run the Google front end appends the real client address, so the
 * trusted entry is counted from the END (TRUSTED_PROXY_HOPS, default 1). CF-Connecting-IP is only honoured when
 * TRUST_CF_CONNECTING_IP=true, i.e. the service really sits behind Cloudflare.
 */
export function clientAddress(
  headers: HeaderReader | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  if (!headers) return "unknown";
  if (env["TRUST_CF_CONNECTING_IP"] === "true") {
    const cf = headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const hops = Math.max(1, Number.parseInt(env["TRUSTED_PROXY_HOPS"] ?? "1", 10) || 1);
  return forwarded[forwarded.length - hops] ?? forwarded[0] ?? "unknown";
}
