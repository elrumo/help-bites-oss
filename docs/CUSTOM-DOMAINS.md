# Custom domains

Serve a project's public pages on your own domain: `feedback.lightbites.app` for the feedback board,
`change.lightbites.app` for the changelog, `blog.lightbites.app` for the blog. Visitors never see the HelpBites
address; the pages, the embeds and the public API answer on your host.

Community installs get this with no limits. On HelpBites Cloud it is part of the Pro plan
(`customPublicDomain`). Editing and verifying domains needs the `projects.manage` permission.

## How it works

1. **Add a host** in *Project → Settings → Custom domains*, and pick what its root (`/`) opens: the public hub,
   the feedback board, the roadmap, the changelog or the blog.
2. **Add two DNS records** where your domain's DNS lives:

   | Type | Name | Value | Why |
   |---|---|---|---|
   | `TXT` | `_helpbites.feedback.lightbites.app` | `helpbites-verify=<token>` | Proves the host is yours. Nobody else can add it once you have. |
   | `CNAME` | `feedback.lightbites.app` | your HelpBites host (for example `support.yourdomain.com`) | Sends visitors here. |

   A bare domain (`lightbites.app`) cannot hold a CNAME. Use your DNS provider's ALIAS/ANAME record, or an `A`
   record to the address in `CUSTOM_DOMAIN_IP` (the panel shows the right one when the server has it set).
   Keep the record **DNS only**: a proxy such as Cloudflare's orange cloud hides the target from the check and
   gets its own certificate.
3. **Check DNS.** When both records are found the host is *Live*. DNS can take a few minutes to spread: check
   again. A certificate is issued by your reverse proxy the first time the host is visited (see
   [Certificates](#certificates)).

Every public page is reachable under every host of the project, so `feedback.lightbites.app/changelog` works too;
the target only chooses what `/` shows. The panel, its login and the admin API are **not** served on a custom
host (they answer `404`).

## What changes on the page

- Links the page builds for itself (the blog's canonical URL and sitemap, the legal page's language links, the
  hub's section links, pricing return links) use your host.
- Scripts load from your host. Replace the HelpBites host in a snippet with yours and nothing else changes:

  ```html
  <script src="https://feedback.lightbites.app/feedback.js" data-project="pk_…"></script>
  ```

- Forms and checkout return links accept your host as "this site" without adding it to the project's allowed
  origins.
- **Mail still links to the main HelpBites host.** Unsubscribe and confirmation links, and the legal links that
  are saved on the project for email, use `APP_URL`.

## Certificates

HelpBites checks the DNS; your reverse proxy gets the certificate. With the bundled Caddy (the `proxy` profile)
there is nothing to do: `Caddyfile` asks `GET /v1/internal/domain-check?domain=<host>` before it requests a
certificate, and the app answers `200` only for verified hosts, so no one can make your server request
certificates for hosts you did not register.

```caddyfile
{
	on_demand_tls {
		ask http://app:3000/v1/internal/domain-check
	}
}

https:// {
	tls { on_demand }
	@root path /
	rewrite @root /_domain
	reverse_proxy app:3000 { flush_interval -1 }
}
```

Other proxies need the same two things: a certificate for each verified host (ask the endpoint above, or add
the host by hand), and `/` sent to `/_domain` for hosts other than your main one (the home page is a static file,
which the app cannot redirect by itself). `X-Forwarded-Host` (or `Host`) must reach the app unchanged.

## Settings on the server

| Variable | Meaning |
|---|---|
| `CUSTOM_DOMAIN_TARGET` | The host the CNAME must point at. Default: the host of `APP_URL`. |
| `CUSTOM_DOMAIN_IP` | An address for bare-domain `A` records. Optional. |
| `CUSTOM_DOMAIN_RESERVED` | Comma-separated suffixes nobody may claim (`helpbites.app,example.dev`). `APP_URL`, `ADMIN_URL` and the target are always reserved. |

## Limits

- 5 domains per project; a host belongs to one project, anywhere on the server.
- 30 hosts added per workspace per hour; 10 DNS checks a minute per host.
- A verified host is not re-checked: if you move the domain away, remove it here.

## API

All calls need an operator session or an `ak_` admin key (`Authorization: Bearer ak_…`).

```bash
# Add feedback.lightbites.app, opening on the feedback board
curl -X POST https://help.example.com/v1/admin/projects/PROJECT_ID/domains \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"host":"feedback.lightbites.app","target":"feedback"}'
# → { "domain": { "id": "…", "host": "…", "state": "pending", "dnsRecords": [ { "type": "TXT", … }, { "type": "CNAME", … } ] } }

# Check the DNS
curl -X POST https://help.example.com/v1/admin/projects/PROJECT_ID/domains/DOMAIN_ID/verify \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"

# List, change what "/" shows, remove
curl https://help.example.com/v1/admin/projects/PROJECT_ID/domains -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"
curl -X PATCH …/domains/DOMAIN_ID -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H "Content-Type: application/json" -d '{"target":"changelog"}'
curl -X DELETE …/domains/DOMAIN_ID -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"
```

`state` is `pending` (never checked), `verified` or `failed`; each record in `dnsRecords` has `valid`:
`valid`, `invalid` or `unknown`. Errors: `400` (not a domain, reserved, too many), `402` (the plan has no custom
domains), `409` (the host is taken).

## In a web page

Nothing to build: the embeds take their address from the script tag (see above). A page of your own can call the
public API on the host (`https://feedback.lightbites.app/v1/feedback?pk=pk_…`); CORS is open on `/v1`.

## In a Swift app

Keep the host in one place and every public call follows it; the project key is still the only credential.

```swift
import SwiftUI

struct Roadmap: View {
    var host = URL(string: "https://feedback.lightbites.app")!   // or your HelpBites host
    var publicKey = "pk_…"
    var accent = Color.accentColor
    var cornerRadius: CGFloat = 12
    @State private var titles: [String] = []

    var body: some View {
        List(titles, id: \.self) { Text($0) }
            .tint(accent)
            .task {
                var parts = URLComponents(url: host.appending(path: "v1/feedback"), resolvingAgainstBaseURL: false)!
                parts.queryItems = [.init(name: "pk", value: publicKey), .init(name: "view", value: "roadmap")]
                struct Reply: Decodable { struct Post: Decodable { let title: String }; let posts: [Post] }
                if let (data, _) = try? await URLSession.shared.data(from: parts.url!),
                   let reply = try? JSONDecoder().decode(Reply.self, from: data) { titles = reply.posts.map(\.title) }
            }
    }
}
```
