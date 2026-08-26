# PACT extension documents

This directory holds the stable documentation for **PACT extensions** —
named, versioned protocol additions that a server advertises alongside the
core specification. It was created with the first entry
([`epistemics.md`](epistemics.md)); before that, extension material lived
only as RFC drafts under [`../v2-prep/`](../v2-prep/).

Conventions:

- **Identifier.** Every extension has a reverse-domain identifier with a
  slash-separated extension name — e.g. `au.tailor.pact/epistemics`,
  `au.tailor.pact/mandate`. The namespace owner maintains the doc.
- **One file per extension**, named for the extension segment
  (`epistemics.md` for `au.tailor.pact/epistemics`).
- **Lifecycle.** An extension drafts as an RFC under `docs/v2-prep/`
  (e.g. [`rfc-mcp-mandate-extension.md`](../v2-prep/rfc-mcp-mandate-extension.md))
  and graduates here once its shape is settled and something implements it.
  Graduation does not imply core-spec status: an extension is normative for
  implementations that advertise it, and invisible to those that do not.
- **Advertisement.** A server declares the extensions it implements — with
  their parameters — in its `/.well-known/pact.json` implementation profile
  (SPECIFICATION §15.1) under an `extensions` object keyed by extension
  identifier. Each extension doc specifies its own parameter shape.
- **RFC 2119.** Extension docs use MUST / SHOULD / MAY as defined in
  [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), scoped to
  implementations that advertise the extension. Rationale sections are
  marked non-normative.

| Extension | Doc | Status |
|---|---|---|
| `au.tailor.pact/epistemics` | [`epistemics.md`](epistemics.md) | DRAFT — registered with the v2.3 draft line |
| `au.tailor.pact/mandate` | RFC: [`../v2-prep/rfc-mcp-mandate-extension.md`](../v2-prep/rfc-mcp-mandate-extension.md) | RFC merged (#40); reference impl in `mcp/` (#42); not yet graduated |
