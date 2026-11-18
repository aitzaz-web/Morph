# Morph

Prototype: an invoicing dashboard ("Ledgerly") that each user can reshape by chatting. The AI can move, hide, resize and restyle the company's existing parts, and add **live views**: filtered, sorted or grouped lists of the company's data, drawn as a table, board, cards or list. It never writes code or changes what a button does. Every change is checked against the company's rules in code, and each user's layout is saved to their account.

## Run

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY (or ANTHROPIC_API_KEY)
npm run dev            # http://localhost:5173  (switch users in the top bar)
```

`npm test` runs the rule, view, permission and saving tests.

## How it fits together

- `shared/registry.ts`: what the company hands Morph: page parts, data sources (fields + actions) and users
- `shared/views.ts`: live view spec, its checks, and the filter/sort/group logic
- `shared/layout.ts`: layout types, default layout, company rules, changes ("ops"), and `replay`, which rebuilds a user's layout from their saved changes on top of the current default
- `server/company.ts`: stand-in for the company's backend: data, permissions (reps only see their own customers), actions
- `server/db.ts`: Morph's own SQLite store of each user's saved changes (`data/morph.db`)
- `server/strategies/common.ts`: prompt, tools, and turning tool calls into checked changes
- `server/strategies/openai.ts` / `anthropic.ts`: the tool-calling loop per provider
- `scripts/try-requests.ts`: run canned requests through a provider and print what changed
- `src/components/LedgerComponents.tsx`: the company's own components
- `src/ViewPanel.tsx`: draws live views with Morph's fixed displays
- `src/Renderer.tsx`: layout JSON → components and views
- `src/Chat.tsx`: the chat panel (undo / reset included)
