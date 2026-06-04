# Chat “Activity Timeline” — thinking & steps restyle

**Date:** 2026-06-04
**Status:** Approved (visual direction chosen via companion: minimal, monochrome, icons, no checkmarks)

## Problem

Our assistant renders reasoning as a raw italic dump behind a `▸ Thought for 4.2s`
toggle ([ThinkingPanel.tsx](../../../components/chat/ThinkingPanel.tsx)). Competitors
(Cursor / Lovable / Manus-style) show a **curated, labeled step timeline** —
"Analyzed your request", "Thought for 7s", "Creating plan" — with small icons and
live status. Ours looks plainer and less trustworthy by comparison.

## Chosen direction

A **minimal monochrome activity timeline** that replaces the raw thinking panel:

- Vertical timeline with a 1px connector line between steps.
- Each step has a small (21px) rounded icon badge. **No checkmarks anywhere** —
  status is carried by the badge + type weight:
  - done → quiet grey icon badge, label in `text-secondary`.
  - active → accent-tinted badge with a soft pulsing halo; label brighter
    (`text-primary`, weight 450) and gently **shimmers** while streaming.
  - upcoming → not shown (we only render steps that have started).
- Type is small & light: 12px label / weight 400, 11px tertiary sub-meta.
- The "Thought for Ns" step stays **expandable** (click ▸) to reveal the reasoning,
  collapsed by default.
- Native to the design system — all colors from `theme-tokens.css`, so it adapts
  to every theme.

## Scope (v1 — UI-only, zero protocol/AI changes)

Derive the timeline **entirely from existing message fields** already populated by
the stream consumer — no new stream events, no system-prompt changes, no
persistence migration. Lowest risk, fully reversible.

Steps derived per assistant message:

| Step | Source field | Active when | Done when |
|------|--------------|-------------|-----------|
| Analyzed your request | implicit (assistant turn) | — | always (settles instantly) |
| Thought for Ns | `thinking`, `isThinking`, `thinkingDurationMs` | `isThinking` | `thinking` present & not thinking |
| Creating / Created plan | `planLoading`, `plan` | `planLoading && !plan` | `plan` present |
| Working… | `status==='running'` with nothing else pending | while running | when content/result arrive |

The active step = the latest step that is not yet done.

### Components

1. **`components/chat/ActivityTimeline.tsx`** (new) — pure presentational. Takes the
   message’s relevant fields, computes the ordered step list via `useMemo`, renders
   the timeline. Scoped `<style jsx>` for the halo/shimmer keyframes (mirrors the
   existing ThinkingPanel pattern — no globals.css churn). Folds in the old
   "Thought for Ns" expandable reasoning.
2. **`components/chat/TaskProgressCard.tsx`** (restyle only) — adopt the same visual
   language for the "tasks being applied" list: monochrome group icon badges,
   trailing status **dots** instead of green checkmarks, glowing active task. Props
   and logic unchanged.
3. **`components/chat/Message.tsx`** — replace the `ThinkingPanel` render slot
   (lines ~327-333) with `ActivityTimeline`. `ThinkingPanel.tsx` left in place but
   unused (easy revert).

### Out of scope (possible follow-ups, would need stream-consumer work)

- Granular per-tool steps ("Read the canvas · 3 nodes", "Added 3 nodes",
  "Edited node X") — needs an append-only `activitySteps[]` accumulator pushed in
  `use-chat-messages.ts` on `tool`/`tool_start` events.
- Model-authored step labels (richer phrasing) — would touch the system prompt’s
  dynamic block and the protocol.
- A collapsing "Worked for Ns" wrapper that folds the whole timeline after the turn.

## Testing

No test runner in this repo. Verify with `npx tsc --noEmit` (per project memory,
lint/build are unreliable here) and an in-app visual check in the dev server across
three turn shapes: plain answer, plan proposal, and plan apply/build.
