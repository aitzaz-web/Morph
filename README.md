# Morph

Morph lets each user of a product reshape their own page by asking. The AI writes that user's page
as React code that may only use the company's own components, and Morph checks it against the
company's rules before saving it. The company's components, data and backend never change.

## How it fits together

| Piece | What it is |
|---|---|
| `packages/service` | Morph's hosted API: the AI, the code checker, and every user's page versions in Postgres |
| `packages/sdk` (`@morph/react`) | What a company installs: `<MorphProvider>` and `<MorphSurface>`, plus the Customize panel |
| `packages/cli` (`morph`) | Uploads a company's manifest (components, data, rules, default page); admin commands |
| `packages/shared` | Types and rules shared by all of the above |
| `examples/ledgerly` | A demo customer: an invoicing app with its own login and backend, using only `@morph/react` |
| `infra` | AWS (CDK): RDS Postgres, Fargate, load balancer, Secrets Manager. See `infra/README.md` |

**A user's request, start to finish:**
1. The user signs into the company's app (the company's own login).
2. The company's server trades its Morph **secret key** for a short-lived **session token** for that user (`POST /v1/sessions`). The browser only ever holds the token.
3. `<MorphSurface>` loads the user's page from Morph (or the company's default page) and renders it with only `react`, `@company` (the company's components) and `@morph` (data, actions, helpers).
4. In the Customize panel, the AI writes a new page. Morph checks the code; the browser renders it and checks the company's rules on screen (up to two repairs); then Morph saves it as a new version.
5. Data and actions go from the company's app to the page directly. Morph's servers never see the company's data, only its manifest.

**Safety rules in place:** pages can only import the three modules; banned browser and network APIs are rejected; actions only run from a user's click and only if the manifest lists them; secret keys are refused from browsers; tokens only work from the company's allowed origins; AI requests are rate-limited per user and per company.
**Not yet:** pages still run in the app's own page, not a sandboxed iframe, so the code checker is the main guard against a page leaking data. Keep all page access going through `@company` and `@morph` so the iframe can be added later without changing pages.

## Run it locally

Needs Node 24+ and Docker.

```bash
npm install
npm run db:up          # Postgres in Docker on port 5433
npm run setup:local    # writes .env files, registers Ledgerly, uploads its manifest
# add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to packages/service/.env
npm run dev            # Morph on :8787, Ledgerly on http://localhost:5173
```

`npm test` runs the checker, service and Ledgerly tests (Postgres runs in memory for tests).
`npm run typecheck` checks every package.

## Adding Morph to an app (what a company does)

1. Write a manifest for a surface (see `examples/ledgerly/morph.manifest.ts`): components with their allowed props and styling hooks, data sources and actions, rules, and the default page.
2. `MORPH_URL=... MORPH_SECRET_KEY=sk_... npx morph push morph.manifest.ts --surface dashboard` on every deploy.
3. Add an endpoint on your server that calls `POST /v1/sessions` with your secret key and the signed-in user's id.
4. Render it:
   ```tsx
   <MorphProvider serviceUrl={MORPH_URL} getToken={fetchTokenFromYourServer}>
     <MorphSurface id="dashboard" components={{ Nav, Invoices }} data={data} actions={{ invoices: { mark_paid } }} />
   </MorphProvider>
   ```

## API

| Endpoint | Credential | |
|---|---|---|
| `POST /v1/admin/tenants`, `PATCH /v1/admin/tenants/:id` | admin key | register a company, set its origins, rotate its key |
| `POST /v1/sessions` | company secret key | session token for one end user |
| `PUT /v1/surfaces/:id`, `GET /v1/surfaces/:id` | company secret key | upload / read a manifest |
| `GET /v1/surfaces/:id/page` | session token | the user's current page, compiled |
| `POST /v1/surfaces/:id/morph` | session token | ask the AI for a new page (not saved yet) |
| `PUT /v1/surfaces/:id/page`, `POST .../page/undo`, `DELETE .../page` | session token | save, undo, reset |
