// Next.js instrumentation hook — wires OpenTelemetry + Azure Monitor traces.
//
// Next 16 looks for `instrumentation.ts` (or `.js`) at the project root and
// invokes its exported `register()` once per server boot, before any request
// handlers run. We use it to bring up the OTel SDK and ship request traces
// to Azure Application Insights.
//
// Logs path: Source's structured JSON logger (`src/lib/logger.ts`) keeps
// writing line-delimited JSON to stdout. Azure Container Apps captures stdout
// and forwards it to Log Analytics, which is queryable in App Insights via
// the `ContainerAppConsoleLogs_CL` table — the same correlation handle (the
// OTel `traceId`, propagated via `traceparent` and surfaced in log entries
// once we wire it through the logger in a follow-up) ties console logs to
// traces in the App Insights UI.
//
// We deliberately do NOT wire the Azure log-record exporter here:
// `AzureMonitorLogExporter` in `@azure/monitor-opentelemetry-exporter@1.0.0-beta.32`
// depends on `@opentelemetry/sdk-logs@0.200.0`, whereas `@vercel/otel@2.1.2`
// pulls `sdk-logs@0.217.0`. The 0.217 `LogRecordExporter` interface added
// `forceFlush()` which the 0.200-targeted Azure exporter does not implement,
// so wiring it would require shimming. ACA stdout capture is the better
// path for now; it's already shipping log lines, and the correlation handle
// is the trace id that this hook now surfaces.
//
// Forward-compatible by design:
//
//   - When `APPLICATIONINSIGHTS_CONNECTION_STRING` is unset (e.g. local dev,
//     PR previews, the `dev` reference branch before Knox provisions the
//     workspace), `register()` no-ops gracefully and the structured logger
//     keeps writing line-delimited JSON to stdout/stderr exactly as before.
//   - When the secret IS set (Knox-action — see WS1 plan + cd-source.yml),
//     OTel boots, the Azure Monitor trace exporter ships request traces to
//     App Insights, and Source's existing `log.*` calls continue working
//     unchanged.
//
// `runtime` guard: Next 16 may invoke `register()` from both Node.js and Edge
// runtimes (e.g. middleware preview compilations). The Azure Monitor exporter
// requires Node.js APIs and will not run on Edge, so we early-return when
// `process.env.NEXT_RUNTIME !== "nodejs"`. Edge spans still propagate their
// `traceparent` headers; downstream Node.js handlers pick up the trace and
// link the spans correctly.

export async function register(): Promise<void> {
  // Edge runtime: middleware + edge functions. The Azure Monitor exporter
  // depends on `@azure/core-rest-pipeline` which uses Node.js HTTP/streams,
  // so we cannot initialise OTel there.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    // Forward-compatible no-op. Structured-JSON logging on stdout is still
    // captured by Azure Container Apps regardless. See OBSERVABILITY.md
    // §"What's deferred" for the activation steps.
    return;
  }

  // Dynamic imports — keeps the OTel + Azure SDK out of the Edge bundle.
  const { registerOTel } = await import("@vercel/otel");
  const { AzureMonitorTraceExporter } = await import(
    "@azure/monitor-opentelemetry-exporter"
  );

  const serviceVersion =
    process.env.SOURCE_VERSION ?? process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";

  registerOTel({
    serviceName: "source",
    attributes: {
      "service.version": serviceVersion,
      "service.namespace": "tailor",
      "deployment.environment":
        process.env.AZURE_REGION === "australiaeast" ? "production" : "dev",
    },
    traceExporter: new AzureMonitorTraceExporter({ connectionString }),
  });
}
