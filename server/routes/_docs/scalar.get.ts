// The API reference: Scalar's browser bundle, served from this origin (see the
// nitro:config hook in nuxt.config.ts), reading the spec Nitro generates. It
// is configured by data attributes, so the page runs no inline script.

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Support chat for any app. Authenticate end users with a host-signed identity token, agents with a Parse session.">
<title>help-bites API</title>
</head>
<body>
<script id="api-reference" data-url="/_docs/openapi.json" data-configuration="{&quot;theme&quot;:&quot;purple&quot;}"></script>
<script src="/_docs/scalar-setup.js"></script>
<script src="/_docs/scalar-standalone.js"></script>
</body>
</html>
`

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "frame-ancestors 'self'; script-src 'self'; object-src 'none'; base-uri 'self'"
  })
  return PAGE
})
