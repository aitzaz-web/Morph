# Morph

## The idea
Morph is an AI layer that companies plug into their existing product so each user can rearrange the UI however they want, just by asking.

- The company keeps all its components and functionality exactly as they are, and provides a default layout.
- Users talk to a chat panel ("put my orders first", "hide recommendations", "make it simpler") and the AI rearranges the existing components for that user only.
- The company sets rules (e.g. checkout must always be visible) so nothing important breaks.
- Each user's layout persists across sessions.

Analogy: a car. The manufacturer builds the engine and features, but the seat and dashboard adjust to whoever's driving. UI should stop being the reason people dislike a product.

Key principle: the AI only changes the arrangement of components, never the functionality or backend.

## The plan
1. **Prototype:** build a simple demo site with a handful of components and a default layout. Test how well the AI rearranges components based on user requests, without worrying about state yet.
2. **Persistence:** save each user's layout so it persists across sessions (a database, not browser cache).
3. **Evaluate:** run a set of test requests and measure how often the AI's layouts are valid and match what the user asked for.
4. **Real-world design:** figure out how an actual company would integrate Morph: handling state, user accounts, constraints, and larger sites.

## How we work
- Two people exploring approaches independently on separate branches, then comparing.
- Start simple, prove the core idea works, then build out.
