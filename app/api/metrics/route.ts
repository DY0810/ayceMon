// Prometheus scrape endpoint.
//
// Gated behind a shared-secret bearer token carried in METRICS_SCRAPE_TOKEN.
// No per-user, per-session, or email-derived labels are ever emitted — the
// only label anywhere on this surface is the build's git SHA, which is
// intentionally not user-identifying.
//
// When METRICS_SCRAPE_TOKEN is unset, the endpoint 404s so that an attacker
// cannot distinguish "present but unauthorized" from "not deployed".

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

export function GET(request: Request): Response {
  const expected = process.env.METRICS_SCRAPE_TOKEN;
  if (!expected) {
    return new Response("not found", { status: 404 });
  }

  const auth = request.headers.get("authorization");
  const presented =
    auth && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;

  // Plain string equality: the expected value is a base64url random string of
  // ≥ 22 chars (see docs/k8s-runbook.md §6). Timing-side-channel leakage over
  // a handful of microseconds does not meaningfully narrow that search space,
  // and token length itself is not a secret. Constant-time comparison would
  // be required if we were comparing low-entropy secrets (passwords, PINs).
  if (!presented || presented !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  const mem = process.memoryUsage();
  const gitSha = escapeLabelValue(process.env.APP_GIT_SHA ?? "unknown");

  const body =
    [
      "# HELP process_resident_memory_bytes Resident set size of the Node.js process, in bytes.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${mem.rss}`,
      "# HELP nodejs_heap_size_used_bytes V8 heap memory in use, in bytes.",
      "# TYPE nodejs_heap_size_used_bytes gauge",
      `nodejs_heap_size_used_bytes ${mem.heapUsed}`,
      "# HELP nodejs_heap_size_total_bytes V8 total heap size, in bytes.",
      "# TYPE nodejs_heap_size_total_bytes gauge",
      `nodejs_heap_size_total_bytes ${mem.heapTotal}`,
      "# HELP nodejs_external_memory_bytes Memory used by C++ objects bound to JS, in bytes.",
      "# TYPE nodejs_external_memory_bytes gauge",
      `nodejs_external_memory_bytes ${mem.external}`,
      "# HELP aycemon_build_info Build metadata. Value is always 1; the git_sha label carries the build identifier.",
      "# TYPE aycemon_build_info gauge",
      `aycemon_build_info{git_sha="${gitSha}"} 1`,
      "",
    ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
