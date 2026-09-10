# dclplace v2 — GDD Summary

A human-readable summary of [`gdd.md`](./gdd.md) and [`pitch.md`](./pitch.md), for review.

---

## 🎯 The Ask

A **4-week v2 build** on top of shipped v1, aimed at the Decentraland Foundation
and Regenesis Labs. v1 shipped Sep 2026 at the Friendzone Mobile Buildathon and
is live at [`dclplace.dcl.eth`](https://decentraland.org/play/?realm=dclplace.dcl.eth)
and Genesis Plaza South ([`-9,-91`](https://play.decentraland.org/?NETWORK=mainnet&position=-9,-91)).

---

## 📊 Why v2 (the v1 numbers)

10 days after launch, zero paid marketing:

| Metric | v1 result | Benchmark |
|---|---|---|
| **D7 retention (rolling)** | **62.5%** | >3× the DCL program's 20% target |
| D7 desktop / mobile | 64.29% / 50% | Both above target |
| Avg session length | **19.2 min** (98% active, 0.34 min AFK) | — |
| Weekly social interactions | **74.29%** of visitors chat or emote | — |
| Unique visitors (10 days) | 184, peak 10 concurrent | Organic Discord + Twitter only |

**The organic growth loop already works:** players screenshot their work → post to
Discord/Twitter → new visitors arrive. v2 is designed to **industrialize that
same loop**, not test a new hypothesis.

---

## 🎨 The Player Promise

> *You are one painter in a shared canvas. You place one pixel per second
> toward what you or your tribe are building — nothing ever resets.*

Familiar comparison: **"Reddit's r/place, but you walk through it in
Decentraland, on your phone, and it never wipes."**

Primary player: artists who like pixel art, r/place-style events, or leaving
persistent marks in shared spaces — arriving alone or via a friend's shared
screenshot.

---

## 🏛️ The Three Pillars

1. **Permanence.** Pixels persist forever. The canvas is state, not a round.
2. **Tap-to-place simplicity.** One gesture, no drag, no cursor. Works
   identically on touch and mouse.
3. **A public square AND a private studio.** *(new in v2)* Every artist gets
   their own persistent space *and* the shared canvas everyone paints on —
   practice, ambition, and audience in the same scene.

---

## 🚀 The Four v2 Features

### 1. Private boards (Week 1)
Each player gets their own persistent canvas that overlays the public one.
Storage-per-wallet, 30s dirty-flush (same architecture as public). A UI toggle
switches between the two.

**Why:** an owned, no-decay space you can return to. This becomes the primary
D1 hook (see §4.1 of the GDD).

### 2. Full color picker (Week 2)
Replace the 8-swatch bar with a full color picker. The 8 palette colors stay
as quick-select for tribe coordination; the picker unlocks the rest for
serious artists.

### 3. One-tap image exporter (Week 3)
Promote the half-built server-side snapshot pipeline into a user-facing
button. Tap → get a shareable PNG (public canvas or your private board) with a
small watermark/attribution line.

### 4. View-only board sharing (Week 4)
Generate a shareable link per private board. Recipients can load the board
read-only. Collaborative editing is deliberately deferred to v3 (permissions +
moderation).

---

## 🎯 Return Hooks (v2)

Two hooks, both measured as `[HYPOTHESIS]` until v2 playtests:

| Hook | Trigger | What the player anticipates |
|---|---|---|
| **Private board (v2)** | Anytime — exactly as they left it | "My studio is waiting; I want to finish that piece." |
| **Public-canvas traces** | Anytime — may have been painted over | "Is my mark still standing?" |

Neither hook uses reminders or timers. The canvas *itself* is the memory.

---

## 👥 Social Model

**Two social loops in v2:**

- **Public:** A paints a shape → B sees it → paints over/alongside/extends →
  emergent tribe formation, defended regions, visible consequence.
- **Private-to-social:** A builds ambitious art privately → shares a view-only
  link → B loads it, screenshots, posts to Discord/Twitter → external audience
  discovers the scene.

**Honest disclosure (from GDD §5):** with all other players removed, this
is still a solo game with strong social evidence around it. The canvas is
the shared language — no voice needed.

---

## 📱 Cross-Platform

Same core loop on both platforms. v1 already validated:
- Desktop D7: 64.29%
- Mobile D7: 50% (mobile = ~33% of unique traffic)
- 60fps desktop / 30fps mobile targets, 300 addEntity/frame ceiling to
  protect mobile's entity allocator

No desktop-only dependencies. Mobile is a first-class citizen, not a port.

---

## ⚠️ Top Risk & Fallback

**Risk (H2-05):** private boards may *reduce* public-canvas activity by >30%
— artists retreat to private space, public canvas thins out.

**Floor v2 must not fall below:** v1 baseline of D7 62.5% + 74.29% weekly
social-interaction rate.

**Fallback:** gate private-board access behind a threshold of public-canvas
pixels placed ("earn your studio") — the public canvas becomes onboarding
for the private space.

---

## 🧪 Hypotheses To Kill In v2

Tracked in the pitch's hypothesis log:

- **H2-01** Private boards make the game *more* social, not less
- **H2-02** A user-facing exporter multiplies organic marketing beyond
  manual screenshotting
- **H2-03** An expanded palette does not fragment tribe recognition
- **H2-04** Private board is a stronger D1 hook than public-canvas traces
- **H2-05** *(top risk)* Private boards reduce public-canvas activity >30%

---

## 🚫 Explicitly NOT In v2

1. **Collaborative private boards** — view-only in v2; write access is v3
2. **Pixel attribution** ("placed by Alice, 3 days ago") — inflates CRDT payload
3. **Larger public canvas** — the Genesis 20×20 estate is a hard boundary;
   private boards address the space demand instead

---

## 📞 Contact

- Discord: `ile9466`
- Full GDD: [`gdd.md`](./gdd.md)
- Pitch one-pager: [`pitch.md`](./pitch.md)
