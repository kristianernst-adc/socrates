# Evaluation cases for the skill

Use these cases to compare an agent with and without `benji-taste`. Judge process traces as well as final output.

## Scoring method

For each case, score the agent from 0 to 2 on every assertion:

- **0:** absent or contradicted
- **1:** partially present
- **2:** clearly present and correctly applied

A strong run should score at least 80% and must not violate a hard gate in `SKILL.md`.

## Case 1 — Dense AI model settings panel

Prompt:

> Redesign an AI inference settings panel with 28 controls. Most users change model, temperature, and max tokens; experts also need sampling, penalties, stop sequences, seed, reasoning effort, tools, and structured output.

Assertions:

- Keeps frequent essentials immediately accessible.
- Defers advanced controls contextually without making them hard to find.
- Groups advanced options by user intent, not merely by data type.
- Preserves entered values when sections open, close, or switch modes.
- Defines loading, validation, reset, import, error, and incompatible-option states.
- Does not hide safety-critical limits for visual cleanliness.
- Provides a keyboard- and screen-reader-viable interaction model.
- Avoids gratuitous animation.

## Case 2 — High-stakes crypto transfer confirmation

Prompt:

> Design and implement a transfer confirmation flow for a self-custody wallet. It must show amount, destination, network, fee, and signing state.

Assertions:

- Treats correctness, security, and clarity as gates.
- Preserves continuity from selected asset and recipient into confirmation.
- Uses sober pre-commit feedback and reserves celebration for successful completion.
- Makes irreversible consequences and destination legible at commitment.
- Handles insufficient funds, fee change, network mismatch, rejected signature, timeout, and retry.
- Motion clarifies source, destination, and state rather than slowing the flow.
- Reduced motion retains all meaning.
- Does not use visual craft to conceal uncertainty or latency.

## Case 3 — Realtime collaborative chat

Prompt:

> Propose a distinctive realtime chat experience for close friends. It should feel alive and playful without making ordinary messaging exhausting.

Assertions:

- States one coherent interaction thesis connected to presence.
- Lets the thesis affect behavior, not only branding.
- Uses play, sound, haptics, or physics selectively and with opt-outs.
- Keeps the frequent send/read loop immediate.
- Reserves richer effects for infrequent or meaningful moments.
- Supports safe discovery without compromising predictability.
- Includes offline, reconnecting, typing, failed-send, edited, deleted, and reduced-motion states.
- Distinguishes expressive experimentation from evidence of product-market fit.

## Case 4 — Animated status icon system

Prompt:

> Implement a set of icons that transition among play, pause, retry, loading, success, and error.

Assertions:

- Determines which states represent the same persistent control.
- Uses genuine transformation only where object identity supports it.
- Does not force morphs between unrelated geometries.
- Establishes shared geometric constraints.
- Builds a transition matrix or sequencer.
- Tests every direction, interruption, repetition, and reduced-motion path.
- Judges the running transitions rather than accepting compilable SVG code.
- Fixes perceptual jank with targeted exceptions when needed.

## Case 5 — Realtime data visualization component

Prompt:

> Build a reusable realtime line chart component for irregular incoming telemetry.

Assertions:

- Provides a useful default with a small public API.
- Keeps advanced behavior opt-in.
- Drives related elements from one state source and timing model.
- Uses animation to encode domain meaning.
- Handles loading, pause/resume, stale data, bursty updates, gaps, extremes, and tab suspension.
- Tests stable frame pacing on representative hardware.
- Does not confuse perceived smoothness with actual data freshness.
- Keeps color meaning accessible without relying on color alone.

## Case 6 — Agent-generated landing page review

Prompt:

> Review and refine this generated landing page. It works, but it feels generic and several transitions feel wrong.

Assertions:

- Renders and interacts with the page when tools permit.
- Identifies an interaction thesis before applying random polish.
- Gives element- and state-specific feedback.
- Uses selectors, component names, positions, recordings, or computed styles at appropriate detail.
- Pauses or inspects transient animation states.
- Runs multiple verify-and-correct passes.
- Removes generic decoration that lacks a product reason.
- Does not use vague instructions such as “make it premium” without operational detail.

## Negative-trigger case — Backend-only migration

Prompt:

> Write a database migration that adds an index and backfills a nullable column. There is no user interface.

Expected behavior:

- The skill should not materially influence the work.
- The agent should not invent motion, delight, visual hierarchy, or interface deliverables.

## Regression warnings

Revise the skill if agents repeatedly:

- copy Family-like trays regardless of platform
- add animation before solving information architecture
- hide frequent controls under the banner of simplicity
- overuse confetti, sound, or playful copy
- ignore accessibility because it is not prominent in the source essays
- produce a visual critique without rendering the interface
- give vague aesthetic feedback with no target or verification method
- score their own work highly without evidence
- imply that Taylor authored or endorsed the generated design
