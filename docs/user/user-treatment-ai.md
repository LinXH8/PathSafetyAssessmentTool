## 6.10 AI Score Preview — Before & After Treatment

## Overview

When you select and apply treatments on the **Treatment Application page**, PSAT calculates a **predicted score** for each segment after the treatment is applied. This before/after comparison lets you evaluate the safety impact of a treatment before committing to it.

The comparison is visible in the **Crash Type Scores** panel on the right-hand side of the Treatment Application page.

---

## How the Before / After Comparison Works

1. **Before score** — the original crash type scores (BB, BP, SB, VB, Risk Score) computed from the coded attributes.
2. **Treatment selected** — ticking a treatment checkbox prepares the preview. *(Note: You must toggle "Show Post-Treatment" on in the Attributes panel header to see this preview update).*
3. **After score** — PSAT re-runs the CycleRAP scoring formula with the updated attribute values to produce a predicted post-treatment score.

The difference (reduction) is shown as a **↓ value** beneath each crash type score card. A green indicator confirms improvement; no arrow means the treatment did not affect that crash type.

---

## Reading the Score Cards

When treatments are selected:

- Each card shows the **post-treatment score** in large text.
- A **↓ X.XX** delta beneath it shows how much the score decreased.
- The card background colour reflects the **post-treatment band** — if a treatment moved a segment from High to Medium, the card will show the Medium (yellow/orange) colour.

---

## Previewing Before You Apply

> [!IMPORTANT]
> The **Show Post-Treatment** toggle (located in the Attributes panel header on the right) must be switched **on** to see the live score preview. If it is toggled off, only the original pre-treatment scores will be displayed.

With the toggle enabled, tick any treatment checkbox in the Treatment Options panel to see a **live score preview** for the current segment in real time. The scores and attributes update automatically as you change your selection — you do not need to click Apply.

> **Note:** Selecting treatments only previews the effect — nothing is saved until you click **Apply**.

---

## AI-Assisted Visualisation (Prompt & Image Copy)

On the **Treatment Application page**, two clipboard buttons help you create visual representations of proposed improvements using external AI image tools:

- **Copy prompt** — copies a ready-to-use text prompt describing the selected or applied treatments. Use the dropdown to choose:
  - **Copy Applied** — prompt based on treatments already **applied and saved** for this segment.
  - **Copy Selected** — prompt based on treatments currently **ticked/selected** in the panel.

  Paste the prompt into an AI image generation tool (such as ChatGPT or DALL·E) to generate a mock-up of what the improved path might look like.

- **Copy image** — copies the current segment photograph directly to your clipboard. Paste it alongside the prompt so the AI tool has the actual scene to work from.

Use **Copy Selected** when exploring options and want to preview before committing. Use **Copy Applied** when you have already applied treatments and want to generate the final before-and-after visualisation.

---

## Tips

- The score preview updates instantly on checkbox selection — use it to compare multiple treatment combinations before applying.
- If a treatment does not produce a score improvement, check whether the relevant attributes are already at their best value for that segment.
- Treatments are applied per segment in **By Segment** mode, or across all eligible segments in **By Treatment** mode.
- For pasting AI-generated images into the report, see [Section 5: Report Generation](../user/user-report-generation.md).
