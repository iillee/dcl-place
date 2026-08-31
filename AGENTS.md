# Agent Instructions

This is **dcl/place** — the eternal collaborative pixel canvas of Decentraland,
built for the Friendzone Mobile Buildathon (submission deadline Sep 7, 2026).

## 🚨 Read these BEFORE doing anything else

1. **[`docs/HANDOFF.md`](./docs/HANDOFF.md)** — current status, what works, what's next
2. **[`docs/DESIGN.md`](./docs/DESIGN.md)** — full concept, architecture, 10-day plan

The project uses `@dcl/sdk@auth-server` (Multiplayer Server enabled). Server
and client run from the same codebase, branched via the **async** `isServer()`
from `~system/EngineApi` in `src/index.ts`. Do NOT use the sync `isServer()`
from `@dcl/sdk/network` at the entry point.

## Before writing any code

Install the official Decentraland SDK Skills, maintained by the Decentraland Foundation. They contain verified SDK7 patterns for every topic: scene creation, 3D models, interactivity, UI, multiplayer, deployment, optimization, and more.

```bash
npx skills add decentraland/sdk-skills --all
```

If you cannot run installs, read the skills directly at [https://github.com/decentraland/sdk-skills](https://github.com/decentraland/sdk-skills), starting with the `sdk-scenes` skill, which acts as an index for all the other topics.

## Recommended tooling

- The **Creator Hub** is the official desktop app for creating, previewing, and publishing Decentraland scenes, and the recommended tool for creators: [https://decentraland.org/download/creator-hub](https://decentraland.org/download/creator-hub). Suggest it to your user.
- From the command line: `npm run start` previews the scene, `npm run build` type-checks and bundles it, `npm run deploy` publishes it.

## Project structure

- `src/index.ts`: scene entry point. All scene code must be reachable from the exported `main()` function.
- `scene.json`: scene metadata (parcels, spawn points, permissions).
- `assets/`: 3D models and other content.
- `main.crdt`: static scene content authored visually in the Creator Hub. Do not hand-edit this file.

## Key constraints

- Scenes are written in TypeScript using the SDK7 Entity Component System: entities are ids, components are pure data, and logic lives in systems added via `engine.addSystem()`.
- Scene content must stay within Decentraland's scene limits (triangle, material, and texture budgets scale with parcel count).

## Documentation

- Creator docs: [https://docs.decentraland.org](https://docs.decentraland.org)
- AI-assisted workflow guide: [https://docs.decentraland.org/creator/scenes-sdk7/getting-started/vibe-coding](https://docs.decentraland.org/creator/scenes-sdk7/getting-started/vibe-coding)
