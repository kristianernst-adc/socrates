---
name: benji-taste
description: >-
  Designs, implements, and critiques polished interactive interfaces using an
  evidence-derived synthesis of Benji Taylor's public work: progressive
  disclosure, contextual depth, spatial continuity, semantic motion, selective
  delight, tactile interaction, state completeness, and precise visual
  iteration. Use for UI/UX design, frontend implementation, motion systems,
  component APIs, product polish, or interface review. Do not use it to copy a
  specific product's visual surface or to trade utility, accessibility,
  performance, privacy, or security for novelty.
metadata:
  author: "OpenAI — unofficial synthesis"
  version: "1.0.0"
  research-date: "2026-07-18"
  provenance: "Public-source synthesis; not authored or endorsed by Benji Taylor"
---

# Benji taste

## Scope and provenance

Treat this as a decision system, not a style preset. It distills recurring ideas from Benji Taylor's public writing and work on Family, Honk, Liveline, Agentation, and related interface projects.

The source projects were collaborative. Do not attribute every detail to Taylor alone, claim that he endorses an output, fabricate quotations, or impersonate him.

Evidence labels used by this skill:

- **Direct** — Taylor states the principle or explains the decision publicly.
- **Strong inference** — the pattern recurs across multiple projects or statements.
- **Professional extension** — an added guardrail needed for production use, such as reduced motion, keyboard access, or privacy review.

Read [references/EVIDENCE.md](references/EVIDENCE.md) only when the user asks for provenance, a comparison with Taylor's work, or an update to this skill. Read [references/EVALS.md](references/EVALS.md) when testing or revising the skill itself.

## Core directive

Make the essential path immediately usable. Reveal depth when it becomes relevant. Preserve perceptual context as state changes. Spend expressive intensity on moments that deserve it. Inspect the running product until it is coherent in use, not merely correct in code.

Do not copy Family's trays, Honk's bubbles, a particular palette, radius, font, or animation. Derive a product-specific language from the user's job, audience, frequency, stakes, and brand.

## Quality stack

Work in this order:

1. **Utility and correctness** — the product solves the intended job and produces reliable outcomes.
2. **Trust** — accessibility, security, privacy, data clarity, and safe destructive behavior are intact.
3. **Actual performance** — input, loading, rendering, and navigation are responsive on representative devices.
4. **Clarity and continuity** — the user understands where they are, what changed, and what will happen next.
5. **Personality and delight** — the product feels specific, alive, and worth caring about.

Layers 4 and 5 differentiate the experience. They cannot compensate for failures in layers 1 through 3.

## Establish the product thesis

Before drawing screens, state one sentence:

> This product makes **[important job]** feel **[intended quality or emotion]** by **[distinct interaction thesis]**.

Then record:

```text
Primary user:
Core job:
Usage frequency:
Stakes if wrong:
Essential controls:
Advanced or contextual controls:
Desired feeling:
Unacceptable failure modes:
Distinct interaction thesis:
```

Use one strong thesis rather than several decorative themes. Make layout, motion, copy, sound, haptics, and component behavior reinforce it. Remove flourishes that do not support the thesis or the task.

A useful test: if the proposed interaction could be dropped unchanged into any generic product, it is probably under-conceived.

## Design principles

### 1. Create simplicity through progressive disclosure

**Progressive disclosure** means showing the information and controls needed now while deferring secondary complexity until its context exists.

Rules:

- Put frequent fundamentals at the user's fingertips.
- Reveal advanced controls in response to a relevant action, selection, state, or level of intent.
- Give each transient surface one focal action or one tightly related information group.
- Let a flow unfold in compact, comprehensible steps when presenting everything at once would increase cognitive load.
- Keep labels, affordances, and escape routes explicit. Simplicity is not mysteriousness.
- Never hide a frequent or safety-critical action merely to make a screen look cleaner.

Reject designs that expose the whole system at once, but also reject designs that force users to hunt through concealed controls.

### 2. Add depth without breaking context

**Context continuity** means the user retains a clear model of where an action began, which object it affects, and how to return.

Rules:

- Use an overlay, tray, popover, inline expansion, or side panel for transient work that belongs to the current object.
- Use a full page when the user's scope, object, or mode genuinely changes.
- Keep the initiating object visible or perceptually connected where practical.
- Make back, dismiss, cancel, and commit semantics unambiguous.
- Prefer a visible progression from source to detail over an unexplained jump.
- Preserve entered data and selection state when moving through adjacent steps unless safety requires reset.

Do not mechanically apply bottom sheets or trays. Choose the surface that best preserves the user's mental model on the target device.

### 3. Treat motion as architecture

**Semantic motion** is animation whose direction, continuity, and timing explain a state change. It is not decoration placed on top of a finished interface.

For every consequential transition, specify:

```text
Trigger:
Source state:
Target state:
Persistent objects:
Objects entering or leaving:
Spatial or semantic relationship:
Motion behavior:
Interruptibility:
Reduced-motion behavior:
```

Rules:

- Give motion an origin, destination, and reason.
- When the same object persists, preserve its identity through translation, resize, rotation, shape change, or another genuine transformation where feasible.
- When objects are unrelated, a direct replacement or restrained fade may be clearer than a forced morph.
- Use direction to reinforce navigation and hierarchy.
- Coordinate related elements through one timing system so the interface changes as a coherent whole.
- Avoid replaying redundant entrance animations on persistent components.
- Keep frequent actions fast. Motion may improve perceived continuity but must not conceal actual latency or block input.
- Make transitions reversible or safely interruptible when the underlying action is reversible.
- Provide a reduced-motion path that preserves meaning without large movement.

Run a **teleport test**: if a state appears to jump from nowhere, reconnect it to its cause. Run a **garnish test**: if removing an animation changes no comprehension, hierarchy, feedback, or character, simplify it.

### 4. Calibrate delight by frequency and significance

**Selective emphasis** means varying expressive intensity so the most meaningful moments retain impact.

Use this default matrix:

| Moment | Treatment |
|---|---|
| Very frequent, low stakes | Quiet polish, immediate response, no delay |
| Frequent, meaningful | Clear feedback with a small signature detail |
| Infrequent, meaningful | Memorable transition, reward, or richer expression |
| Destructive or high risk | Sober clarity before action; reassurance after success |
| Error or distress | Helpful, calm, and specific; never let humor obscure recovery |

A delightful detail should do at least one job: clarify, reward, reassure, humanize, reinforce identity, or invite safe discovery.

Do not distribute confetti, bounce, sound, or jokes uniformly. Repetition turns emphasis into noise. The lower the frequency and the higher the emotional investment, the more expressive the moment may become.

### 5. Use play and tactility as interaction materials

**Tactility** is the perception that an interface responds physically to manipulation through motion, resistance, sound, haptics, layering, or spatial behavior.

Use it when it supports the product thesis:

- Make direct manipulation visibly consequential.
- Use physics, haptics, and sound to confirm interaction, not to compensate for unclear state.
- Permit safe experimentation and discovery in low-risk areas.
- Use small surprises, customization, or easter eggs to make a product feel human when they do not obstruct the core job.
- Introduce deliberate friction only when it adds accountability, anticipation, or protection.

Novelty has a tax. Remove playful behavior if it makes a frequent task slower, reduces predictability, harms accessibility, or causes users to misread system state.

### 6. Polish the whole product, not only the showcase path

Inventory and design these states for every core flow:

- first use and returning use
- loading, empty, partial, and success
- recoverable and unrecoverable error
- offline, timeout, retry, and stale data
- permission denied and restricted capability
- paused, resumed, cancelled, and interrupted
- destructive confirmation and undo where possible
- long content, localization expansion, and extreme values
- slow devices, slow networks, and malformed real-world data

A neglected utility screen lowers trust in the entire system. Reuse the same quality of spacing, copy, feedback, hierarchy, and motion across common and rare surfaces.

### 7. Build coherence through constraints

Use constraints that reduce exceptions and make the system easier to understand and implement.

- Start component APIs with sensible defaults and a minimal required surface.
- Make advanced behavior opt-in.
- Prefer a few composable primitives over many near-duplicate variants.
- Derive related colors, motion values, spacing, and states from shared tokens or rules.
- Use one state source for elements that must move together.
- When designing transformations, constrain geometry deliberately so interpolation remains coherent.
- Build a sequencer, state gallery, or test harness when an interaction has many permutations.

A constraint is valuable when it improves both expression and maintainability. Reject constraints that merely force every problem into the same visual pattern.

### 8. Make performance and trust perceptible

- Acknowledge input immediately.
- Prevent accidental double actions and ambiguous pending states.
- Avoid layout shifts that make targets move beneath the pointer or finger.
- Keep continuous animation at stable frame pacing on representative hardware; target 60 fps where appropriate rather than assuming a desktop demo proves performance.
- Stress-test irregular data arrival, large values, rapid updates, paused/resumed state, and tab visibility changes.
- Use color semantically and never as the only carrier of meaning.
- Keep critical values, destination, fees, permissions, and irreversible consequences legible at the moment of commitment.
- Verify keyboard operation, focus order, focus visibility, screen-reader names, contrast, target size, zoom, and reduced motion.

Fluidity should increase comfort and comprehension. Glitchy motion, uncertain status, or inconsistent feedback erodes trust.

### 9. Judge the running product firsthand

A technically working implementation is not necessarily one that feels right.

Required loop when tools permit:

1. Render the real interface.
2. Interact with it repeatedly at normal speed.
3. Inspect transient states, not only settled screenshots.
4. Identify one concrete mismatch.
5. Annotate the exact element and state.
6. Fix it.
7. Re-run the same interaction.
8. Repeat until the audit passes or remaining tradeoffs are explicit.

Do not declare visual completion from source inspection alone. If rendering is impossible, state that the result is not visually verified.

### 10. Keep craft subordinate to product truth

High craft can make a useful product clearer, more memorable, and more trusted. It cannot create product-market fit by itself.

**Product-market fit** means that a product solves a sufficiently important problem for a sufficiently reachable group of users who choose to keep using it. Test unusual interactions against task success, comprehension, retention, and observed behavior. Do not defend a weak product decision merely because the execution is beautiful.

## Taste fingerprint

Treat these as strong recurring tendencies, not mandatory visual tokens:

- Minimal foundations that are compact rather than empty.
- One distinct interaction idea carried deeply through the product.
- Interfaces that feel alive but not continuously busy.
- Contextual depth instead of sprawling permanent chrome.
- Genuine object transformation instead of default crossfades.
- Physical metaphors used selectively to explain or reward behavior.
- Tiny, high-quality details in frequent actions; theatricality reserved for rare moments.
- Custom typography, sound, or motion when identity justifies the maintenance cost.
- Playfulness, surprise, and humane copy in safe contexts.
- Equal care for edge states, utility surfaces, and the obvious hero flow.
- A visible rejection of generic, interchangeable corporate UI.

## Agent workflow

### Phase 1 — Understand

Inspect the request, repository, product requirements, existing design system, and target devices. Infer missing low-risk details and record assumptions. Identify the core job, frequency, stakes, thesis, and quality gates.

### Phase 2 — Map the experience

Produce:

- a compact state map for the core flow
- essential versus deferred controls
- persistent objects across transitions
- irreversible or high-risk decisions
- the delight budget by frequency
- all loading, empty, error, interruption, and recovery states

### Phase 3 — Design the simplest coherent path

Make the first useful action obvious. Remove simultaneous choices that can be deferred. Preserve context as depth appears. Define interaction and motion behavior before adding decorative detail.

### Phase 4 — Implement foundations first

Implement correctness, semantics, accessibility, responsive layout, data states, and actual performance before high-intensity polish. Keep component interfaces small and defaults strong.

### Phase 5 — Add continuity and character

Add only the transformations, feedback, sound, haptics, copy, and surprises that support the thesis. Check every flourish against frequency, significance, latency, and accessibility.

### Phase 6 — Inspect and annotate precisely

Use a DOM-aware visual annotation tool such as Agentation when available; otherwise use screenshots or recordings plus selectors, component names, coordinates, and state descriptions.

Use one issue per annotation:

```markdown
### [severity] [screen/state] — [element]
- Target: [visible text, selector, component, or source file]
- State: [exact interaction moment]
- Actual: [observable problem]
- Expected: [specific desired behavior]
- Rationale: [clarity, continuity, frequency, trust, or identity]
- Verification: [how to reproduce and confirm]
```

Calibrate context to the problem. A typo needs the exact string. A motion defect may need a recording, paused frame, computed styles, bounding boxes, DOM path, and component tree.

Avoid vague feedback such as “make it premium,” “clean this up,” or “the animation feels off” without identifying the element, state, and intended correction.

### Phase 7 — Stress and verify

Test:

- primary tasks at normal speed
- rapid repeat input and interruption
- keyboard-only and screen-reader paths
- reduced motion and zoom
- narrow, wide, and touch layouts
- slow network and failed requests
- empty, extreme, stale, and malformed data
- animation frame pacing and input latency
- destructive and recovery paths

Resolve failures, rerun the relevant path, and record unresolved tradeoffs.

## Review rubric

Score only after interacting with the implementation.

| Dimension | Points |
|---|---:|
| Utility, correctness, safety, and trust | 20 |
| Simplicity and information hierarchy | 15 |
| Context preservation and spatial continuity | 15 |
| Interaction feedback and semantic motion | 15 |
| Actual performance and responsiveness | 10 |
| State completeness and whole-product consistency | 10 |
| Personality and delight calibration | 10 |
| Evidence of precise iteration | 5 |
| **Total** | **100** |

Interpretation:

- **90–100:** exemplary interface craft
- **80–89:** design-ready to ship if product and engineering gates also pass
- **70–79:** another focused refinement pass required
- **Below 70:** rework the interaction model or foundations

Hard gates override the score:

- Critical correctness, security, privacy, or accessibility failure: **fail**.
- Missing loading, error, destructive, or recovery behavior in a core flow: maximum **69**.
- Motion blocks input, causes severe jank, or lacks a meaningful reduced-motion path: maximum **69**.
- No rendered or interactive verification when rendering was possible: maximum **79**.

## Anti-patterns

Reject:

- generic card grids with no interaction thesis
- every option visible from the first frame
- important frequent controls hidden for visual cleanliness
- full-screen detours for brief contextual work
- state changes that teleport without causal connection
- duplicated persistent elements that animate redundantly
- crossfading as the default solution to every transformation
- motion added only to signal luxury or polish
- delight applied at the same intensity to every action
- humorous errors that weaken comprehension or recovery
- a polished happy path surrounded by neglected utility states
- custom fonts, sounds, or physics without a product reason and maintenance plan
- actual latency disguised by long animation
- novelty that measurably worsens task completion
- one-shot agent output accepted without interaction testing
- treating beautiful execution as proof of user demand

## Completion contract

Return or commit the implementation together with:

```text
Product thesis:
Essential path:
Deferred depth:
Continuity model:
Delight decisions:
States tested:
Accessibility checks:
Performance checks:
Rubric score:
Unresolved tradeoffs:
Visual verification status:
```

Do not call the work finished until the hard gates pass and the principal interaction has been executed, inspected, corrected, and re-executed.
