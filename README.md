# Morph: code mode

Prototype: an invoicing dashboard ("Ledgerly") where each user reshapes their own page by chatting, and **the AI writes the page as real React code**. It imports the company's components as a fixed library, so it can build any structure (tabs, boards, banners, new widgets, its own CSS), but it can't change what the components do or touch the backend. Each user's page is stored as a version in SQLite. Nothing in the repo changes and nothing is redeployed.

This is the "code" side of the comparison with `tailai/integration`, where the AI edits layout data instead. The Ledgerly demo (components, company backend, users) is copied from that branch so both sides reshape the same app.

## Run

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY (or ANTHROPIC_API_KEY)
npm run dev            # http://localhost:5173  (switch users in the top bar)
```

`npm test` runs the code-checker and server tests. Writing pages works better with `MORPH_EFFORT=medium` (the default) than `low`.

## How a request flows

1. The chat sends the request to `/api/morph`. The server takes the user's current page (latest saved version, or the default).
2. The AI writes a complete new page (TSX + CSS) with its one tool, `write_page`.
3. The server checks the code. It may only import from `react`, `@company` and `@morph`. It may not use browser, network or eval-style APIs or `dangerouslySetInnerHTML`, it must render the components the company requires, and its CSS may not use `url()` or `@import`. Rejected pages go back to the AI to fix.
4. The browser renders the candidate and checks the company's rules **on screen**: Create invoice visible, near the top, big enough and not covered; Nav at the top. On failure it reverts and asks the AI to repair, up to twice.
5. Only a page that passes is saved (the server checks the code again). Undo and Reset step back through the saved versions.

## Where things are

- `src/morph/company.tsx`: the `@company` module, wrapped versions of the company's components (only allowed props, tagged for the rule check)
- `src/morph/sdk.tsx`: the `@morph` module: `useCompanyData`, `useAction`, `Panel`, `money`, `shortDate`
- `src/morph/default-page.tsx`: the company's default page, written the same way the AI writes pages
- `src/morph/runtime.tsx`: loads and runs a compiled page; `src/morph/ruleCheck.ts`: the on-screen rule check
- `shared/registry.ts`: components (props, styling hooks), data sources, users; `shared/rules.ts`: company rules
- `server/codegen/check.ts`: the code checker and compiler
- `server/strategies/`: prompt, tool and the loop for each provider
- `server/db.ts`: page versions per user (`data/morph.db`)

## Not secure (prototype)

The code checker is a denylist and can be bypassed, for example with computed property names. Pages run in the app's own origin. The demo takes the user from `?user=`, so anyone can save a page for anyone. A real version needs:
- pages in a sandboxed iframe on a separate origin, talking to Morph through a small message channel
- the user taken from the company's login session
- untrusted data kept out of the prompt
- company policies on actions, e.g. click-only, no bulk, confirm first

Backend permissions are enforced by the company's server either way.
