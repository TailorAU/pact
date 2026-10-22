/**
 * Bounded request-body reader (#2889 L1).
 *
 * Every mutating JSON route used to call `req.json()` unbounded — a caller
 * could post a 50 MB payload and the app would buffer + parse it all before
 * any validation ran. This helper streams the body and aborts as soon as the
 * byte count crosses the route's cap, so memory use is bounded regardless of
 * Content-Length honesty (chunked requests with no Content-Length are
 * bounded too).
 *
 * Returns a discriminated result instead of throwing so call sites keep
 * their existing JSON-parse error handling (and its per-route 400 shapes)
 * untouched:
 *
 *     const bounded = await readBodyBounded(req);          // or (req, ADMIN_INGEST_MAX_BODY_BYTES)
 *     if (!bounded.ok) return bounded.response;            // 413, structured
 *     let body: unknown;
 *     try { body = JSON.parse(bounded.text); } catch { ...route's own 400... }
 */
import { NextResponse } from "next/server";

/** Default cap for agent/public mutating routes. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024; // 256 KB

/**
 * Cap for admin bulk routes that legitimately carry whole acts /
 * curriculum frameworks / seed batches (legislation ingest, curriculum
 * ingest, scenarios upsert, PACT legislation contribution).
 */
export const ADMIN_INGEST_MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB

export type BoundedBodyResult =
  | { ok: true; text: string }
  | { ok: false; response: NextResponse };

function tooLarge(maxBytes: number): BoundedBodyResult {
  return {
    ok: false,
    response: NextResponse.json(
      { error: "payload_too_large", message: `Request body exceeds ${maxBytes} bytes`, maxBytes },
      { status: 413 },
    ),
  };
}

export async function readBodyBounded(
  req: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<BoundedBodyResult> {
  // Fast reject when the client declares an oversize body. Content-Length
  // can be absent (chunked) or dishonest, so the streamed count below is
  // the real enforcement; this just avoids reading what's declared too big.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return tooLarge(maxBytes);
  }

  if (!req.body) {
    return { ok: true, text: "" };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}
