// Runs before Scalar's bundle on /_docs/scalar. The bundle's zod probes for
// eval with `Function('')`, which the page's CSP refuses: the probe would only
// log a violation before zod falls back anyway, so skip it.
globalThis.__zod_globalConfig = { jitless: true }
