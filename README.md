# Shelf

A small Cloudflare **Pages** app. Buildless HTML/CSS/JS frontend, Pages Functions, R2 objects, D1 metadata and sessions. No frontend framework, web fonts, icon dependencies, or third-party browser requests. Only Google OAuth requires an external service.

## Deploy to your Cloudflare account

Requires Node 22+ and a Cloudflare account with Pages, R2 and D1 enabled. R2 may require billing activation. No deployment has been performed by this deliverable.

1. Run `npm install`, then `npx wrangler login`.
2. Run `npx wrangler r2 bucket create file-shelf`.
3. Run `npx wrangler d1 create file-shelf`. Copy the returned database ID into `wrangler.toml`.
4. Run `npx wrangler d1 execute file-shelf --remote --file schema.sql`.
5. Run `npx wrangler pages project create file-shelf --production-branch main`. If that name is unavailable, choose another and update `name` and `APP_ORIGIN` in `wrangler.toml`.
6. In Google Cloud Console, configure the OAuth consent screen, and create an OAuth client of type **Web application**. Add the exact redirect URI `https://YOUR-PROJECT.pages.dev/auth/callback`. If the Google consent screen is in testing mode, add your approved users as test users too.
7. Set `APP_ORIGIN` to the exact public origin, without a trailing slash. Set `ALLOWED_EMAILS` to a comma-separated list of exact Google email addresses. Empty means nobody is allowed. This is the administrator-managed allowlist; users cannot edit it.
8. Set secrets: `npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name file-shelf` and `npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name file-shelf`. Paste values at the prompts. Do not commit them.
9. Run `npm test`, then `npm run deploy`. Configure a custom domain before using it for sign-in, update APP_ORIGIN and the Google callback URI, and redeploy. Preview deployment origins deliberately cannot authenticate against a production APP_ORIGIN.

For Pages dashboard Git deployment: framework preset None, no build command, output directory `public`. Apply `schema.sql`, configure the same secrets and bindings. The `functions/` directory must be included in the repository. Drag-and-drop static-only upload does not deploy these Functions.

## Local development

Run `npx wrangler d1 execute file-shelf --local --file schema.sql`. Create an ignored `.dev.vars` file containing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN="http://localhost:8788"`, and `ALLOWED_EMAILS`. Register `http://localhost:8788/auth/callback` with Google, then run `npm run dev`. Modern browsers treat localhost as trustworthy for Secure cookies; use local HTTPS if your browser blocks them. Local data is separate from production. No fake sign-in bypass exists.

## Behavior and boundaries

- Only allowlisted, Google-verified email identities can sign in. Google authorization-code flow uses state plus PKCE; profile is retrieved server-side using Google's access token. Client secrets never reach the browser.
- Sessions are random opaque HttpOnly, Secure, SameSite cookies, expire after 24 hours, and are stored in D1. Every private request rechecks the allowlist; removing an address blocks its existing sessions immediately after configuration deployment.
- Ownership uses Google's stable subject identifier. Folders and listings are private to each user. Folder ownership is checked server-side before writes. Mutations require an exact Origin match.
- Uploads are sequential, bounded at 25 MiB each, buffered within the Worker for simple size enforcement. Best for a small internal team, not bulk or large media ingestion. There is no total-user quota or per-user rate limiter; configure Cloudflare rate limiting before opening uploads to a large group. Cloudflare platform limits and storage costs still apply.
- Each object gets a cryptographically random 256-bit key independent of its original name. Public URLs are `/f/<key>` and require no account. Random links are unlisted, **not confidential**. Anyone receiving a link can redistribute it. No public directory listing is exposed.
- Public downloads use attachment disposition and an inert MIME type. This prevents active uploaded content from executing on the authenticated origin. Inline image/video embedding is intentionally not supported by this first version. Use a separate cookieless asset domain before adding inline active content.
- Public responses support byte ranges and cache for one hour. Ownership metadata is not exposed on public downloads. No rename, move, delete, malware scanning, admin UI, or password-protected sharing in this scope. To remove an object, delete it from R2 and its row from D1; purge cached links if urgent.
- D1 and R2 do not share transactions. A failed metadata insert triggers object cleanup, but an interrupted request can leave an orphan; reconcile periodically for long-running use.

## Verification

`npm test` checks unauthorized access, revoked users, cross-origin requests, OAuth state, folder ownership, streamed size enforcement, inert public downloads, and filename validation. Real Google OAuth, remote D1/R2 and production delivery require the configuration above and an end-to-end deployment check: sign in as approved and unapproved users, upload into nested folders, open a copied link while signed out, and confirm another approved account cannot see the first account's workspace.

## Design notes and research

The interface uses a warm paper palette, a muted green action color, system typography, narrow borders, and one compact table. It avoids ornamental gradients, dashboard metric cards, oversized marketing headlines, and repeated containers. Empty, error, loading, no-results, clipboard failure and upload-limit states have explicit copy. Names render with textContent to avoid stored markup injection. Keyboard focus, semantic table markup, accessible labels, live status messages, and a native modal support everyday use.

Research sources: [Brady UX: audit AI-generated UI](https://bradyux.com/network/resources/ai-design/how-to-audit-ai-generated-ui), [InterfaceKit: what makes a website look AI-generated](https://blog.interfacekit.io/what-makes-a-website-look-ai-generated), and [CHI research on AI-generated UI accessibility](https://mintviz.usv.ro/publications/2025.DIS.2.pdf). Recurring visual patterns informed the restrained layout; research findings are not a substitute for testing real task flows.

Implementation references: [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [Wrangler Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
