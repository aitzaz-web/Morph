# Morph

Prototype: a demo store page whose layout a user can rearrange by chatting. The AI only edits a layout JSON (where components go, shown/hidden/collapsed, width, theme/density/sidebar side). The components and their behavior never change, and company rules are enforced in code.

## Run

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY (or ANTHROPIC_API_KEY)
npm run dev            # http://localhost:5173
```

`npm test` runs the validator tests.

## Layout

- `shared/registry.ts`: component metadata the AI sees (ids, descriptions, importance, allowed regions)
- `shared/layout.ts`: layout types, default layout, company rules, validator, ops
- `server/strategies/common.ts`: prompt, layout tools, and the apply+validate step shared by all providers
- `server/strategies/openai.ts` / `anthropic.ts`: the tool-calling loop per provider (OpenAI `gpt-6.1-sol` by default)
- `scripts/try-requests.ts`: run canned requests through a provider and print what changed
- `src/components/StoreComponents.tsx`: the store's real components (cart, checkout, orders, search, ...)
- `src/Renderer.tsx`: layout JSON → components
- `src/Chat.tsx`: the chat panel (undo / reset included)
