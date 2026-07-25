# §21 conformance vectors — Push Delivery (v2.1)

Vectors for the signed event-delivery primitive (§21).

## Coverage note (honest gap)

These vectors cover the **subscription-management** half of §21: creating a
subscription, and the endpoint-validation rules. They do **not** yet cover the
**delivery** half — the signed envelope shape (§21.3), at-least-once retry with
jittered backoff, and 24-hour dead-lettering (§21.4).

That is a harness limitation, not an oversight. Delivery is a server→client
push, so asserting it requires a listener the conformance runner can bind and
observe; the runner today only issues client→server requests. A
delivery-observing harness is follow-on work, and until it exists an
implementation can pass everything here while never actually signing a
delivery correctly. Do not read this directory as full §21 coverage.

`event-delivery.json` schematises the envelope in the meantime, so at least the
shape is machine-checkable by an implementer's own tests.
