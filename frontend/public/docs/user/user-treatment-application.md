## 4. Treatment Application

The Treatment Application page lets you test safety improvements on one or more cycling path projects. You can explore which interventions apply to each segment, preview how they would change risk scores, apply them, and compare before-and-after risk distributions — all without permanently altering the underlying survey data until you are ready.

> **What's new in v2:** The Treatment Application page was fully redesigned. The core workflow below (select projects → choose By Segment/By Treatment → preview → Apply) is unchanged; what moved is the page chrome:
>
> - **On-canvas action row** — **Save**, **Reset All**, and **Generate/Continue Report** now sit in the page title row instead of the sidebar. There is no dedicated **Exit** button in v2 — clicking any other sidebar link (Home, Quick Select, etc.) takes you straight there.
> - **"Treat All Segments"** (the v1 sidebar shortcut that applied one treatment to every segment regardless of relevance) has been removed. Use **By Treatment** mode (Step 3) instead — it already limits bulk-apply to segments the treatment is actually eligible for, and its **Apply** confirmation dialog is the supported way to roll a treatment out project-wide.
> - **Unsaved-changes guard** — segment-by-segment treatment toggles (**By Segment** mode) auto-save as you go, so there is nothing to lose by navigating away. The only state that can be lost is a **staged bulk selection in By Treatment mode that you haven't clicked Apply on yet** — if you navigate away from the sidebar with such a selection pending, PSAT shows a Save / Discard / Cancel prompt before leaving.
> - **Segment stepper + Effectiveness readout** — the segment navigator and an **Effectiveness** percentage (the share of in-scope segments whose overall risk band improved) now sit together in a context strip below the project tabs.
> - **Overall Risk Level (bottom section)** — the "Overall Treatment Analysis" pie charts described in [Step 9](#step-9-review-the-overall-treatment-analysis) are replaced by **Before/After stacked risk-band bars** per crash type, matching the style used on the Coding and Path Analysis pages; the same before/after comparison and per-tab (All Projects / specific project) behaviour still applies.

---

## Table of Contents

- [Step 1: Find and load your projects](#step-1-find-and-load-your-projects)
- [Step 2: Understanding the workspace layout](#step-2-understanding-the-workspace-layout)
- [Step 3: Choose By Segment or By Treatment view](#step-3-choose-by-segment-or-by-treatment-view)
- [Step 4: Select and preview treatments](#step-4-select-and-preview-treatments)
- [Step 5: Apply treatments](#step-5-apply-treatments)
- [Step 6: Read the segment image, scores, and attributes](#step-6-read-the-segment-image-scores-and-attributes)
- [Step 7: Before and After maps](#step-7-before-and-after-maps)
- [Step 8: Generate AI visualisations of proposed improvements](#step-8-generate-ai-visualisations-of-proposed-improvements)
- [Step 9: Review the Overall Treatment Analysis](#step-9-review-the-overall-treatment-analysis)
- [Tips and common workflows](#tips-and-common-workflows)
- [4.10 AI Score Preview — Before & After Treatment](#410-ai-score-preview--before--after-treatment)

---

### Step 1: Find and load your projects

Project selection is done from the **Projects page**. Select one or more projects and click the green **Treatment Application** button to load them into the treatment workspace.

- Click a row (or tick its checkbox) to select it. Use the **Select All** row to select all visible projects at once.
- Use the **Search** box or **Filter by tag** dropdown to find projects more quickly.
- You can load multiple projects together to compare or apply treatments across them in one session.
- The **Verification Status** column shows ✅ for fully verified projects and ⏳ for projects still in progress.
- Click the **pencil icon** in the Actions column to rename a project or change its tags before loading.

> **v2 tip:** You can also jump straight into Treatment Application from any page using **Quick Select** in the sidebar — see [Section 1.6](../user-getting-started.md#16-quick-select--jump-to-a-workflow-from-anywhere).

---

### Step 2: Understanding the workspace layout

After loading, the workspace is divided into several areas:

- **Project tabs** (shown at the top when you load more than one project) — By default, the workspace starts on the **All Projects** tab to show all loaded projects together. Clicking a specific project tab will focus on that project, jumping to its first segment. On the maps, segments from all other projects will automatically grey out, highlighting only the active project.
- **Before Treatment** and **After Treatment maps** — a side-by-side pair of maps at the top of the page, showing all loaded segments colour-coded by risk level. The right map updates in real time as you apply treatments.
- **A three-column panel** below the maps — Treatment Options on the left, the segment street-level image in the middle, and the Scores & Attributes panel on the right.
- **An Overall Treatment Analysis section** at the bottom with pie charts comparing the risk band distributions before and after your treatments. The charts and percentages dynamically update based on your active tab — showing aggregate data for "All Projects" or specific data for a selected project, updating in real time as treatments are applied.

The **page number** shown at the top right (e.g. `3 / 120`) tells you which segment you are currently viewing out of the total. Use the **Previous** and **Next** buttons, or type a page number directly, to jump to any segment.

---

### Step 3: Choose By Segment or By Treatment view

The **Treatment Options** panel on the left has a dropdown that lets you switch between two views:

| View | What it shows | Best used when |
|---|---|---|
| **By Segment** | Only the treatments that are relevant to the segment you are currently viewing, sorted by how much each treatment would reduce the risk score (most improvement first) | You want to work through the path segment-by-segment and decide on the best fix for each one |
| **By Treatment** | All treatments that are applicable to at least one segment across the entire loaded project, sorted by how many segments each treatment improves | You want to roll out one improvement (e.g. adding signage) across as many segments as possible in one action |

---

### Step 4: Select and preview treatments

Tick the checkbox next to one or more treatments to select them. Selected treatments are highlighted in the panel.

> [!IMPORTANT]
> As soon as you select a treatment, the **Scores card** automatically previews the post-treatment risk scores — no toggle needed. The **Show Pre-Treatment** toggle (located in the Attributes panel header on the right, **on by default**) lets you switch back to the original pre-treatment scores and attribute values at any time; switch it off again to see the post-treatment attribute values alongside the preview scores.

Selecting one or more treatments immediately shows a **live preview** in the **Scores card** on the right of what the risk scores would look like if you applied those treatments to the current segment. The preview updates automatically whenever you change your selection — you do not need to click anything to trigger it.

To see exactly which attribute values would change, switch **off** the **Show Pre-Treatment** toggle — the Attributes panel then updates to display the post-treatment attribute values for your selected treatments, so you can understand the reasoning behind the score change.

> **Note:** Selecting treatments only previews the effect — nothing is saved until you click Apply.

---

### Step 5: Apply treatments

When you are satisfied with your selection, click **Apply (N)** at the bottom of the Treatment Options panel (where *N* is the number of treatments selected):

- **In By Segment mode**, Apply saves the selected treatments for the current segment only. The treatment colours on the After Treatment map will update for that segment immediately. This is saved to disk right away — there is nothing to lose by navigating away afterwards.
- **In By Treatment mode**, Apply triggers a confirmation dialog listing each selected treatment and asking whether to apply it to **all eligible segments** across the loaded project. Confirm to apply in bulk, or cancel to go back. Until you confirm, this bulk selection is only a preview — see the unsaved-changes note at the top of this page.

If you change your mind about an applied treatment on the current segment, click the **Reset** button that appears for that treatment to remove it and restore the original scores for that segment.

---

### Step 6: Read the segment image, scores, and attributes

The **middle column** shows the street-level photograph for the current segment. Use **Previous** and **Next** to move through segments, or jump to a specific page number.

The **right column** shows two panels:

- **Segment Scores** — displays the four CycleRAP risk scores for the current segment: Vehicle-Bicycle (VB), Bicycle-Pedestrian (BP), Single-Bicycle (SB), and Bicycle-Bicycle (BB). When treatments are selected and applied, this panel shows the "after" scores; you can toggle the button to compare with the "before" score.
- **Attributes panel** — lists all coded attribute values for the current segment. The **Show Pre-Treatment** toggle (on by default) switches between the original coded values and the values that would result from the selected treatments; switch it off to see the post-treatment values.

---

### Step 7: Before and After maps

The two maps at the top of the page give you a project-wide view of how treatments are changing risk across all segments:

- **Before Treatment map** — always shows the original risk-band colouring for every segment (green = Low, yellow = Medium, orange = High, purple = Extreme). This map does not change as you apply treatments.
- **After Treatment map** — updates in real time as you apply treatments. Segments that have been treated will shift colour to reflect their new risk band. Segments with no applied treatments remain the same colour as the Before map.

Click any segment on either map to jump directly to that segment's page in the panel below.

> **Linked map panels** — toggling the visibility or layer state on one map panel automatically applies the same change to the other. Both maps always stay in sync so you are always comparing like with like.

---

### Step 8: Generate AI visualisations of proposed improvements

The Treatment Options panel has **two separate buttons** — one for the prompt and one for the image — so each can be copied independently and pasted into AI tools that accept text and image inputs separately (e.g. Gemini, ChatGPT, DALL·E):

- **Copy prompt** — copies a ready-to-use text prompt describing treatments in plain language. The prompt templates have been updated to produce clearer, more accurate visualisation instructions. This button has a dropdown with two options:
  - **Copy Applied** — copies a prompt based on the treatments already **applied and saved** for this segment.
  - **Copy Selected** — copies a prompt based on the treatments currently **ticked/selected** in the panel (even if not yet applied).

- **Copy image** — copies the current segment photograph directly to your clipboard as a standalone action. Paste it into the AI tool separately from the prompt so the tool has the actual scene to work from.

> Prompt and image are copied separately because pasting both simultaneously into tools like Gemini is not supported — copy the prompt first, paste it, then copy and attach the image.

Once the AI tool generates an "after" image, you can copy it and paste it back into PSAT's **Post-Treatment Image** area for that segment (see [Section 4: Report Generation, Top Risk Stretches](../user-report-generation.md#547-top-risk-stretches) for the equivalent Report Builder upload) — it is stored as that segment's **Post-Treatment Artistic Impression** and used as the "after" photo wherever the segment is shown.

---

### Step 9: Review the Overall Treatment Analysis

Scroll to the bottom of the page to see the **Overall Treatment Analysis** section. It shows two rows of five pie charts each — one row for **Before Treatment** and one for **After Treatment**:

- Each pie chart covers one crash type: **Overall**, **Vehicle-Bicycle (VB)**, **Bicycle-Pedestrian (BP)**, **Single-Bicycle (SB)**, and **Bicycle-Bicycle (BB)**.
- Each chart shows how the segments in the loaded project are distributed across the four risk bands (Low, Medium, High, Extreme).
- The After Treatment row updates as you apply treatments, so you can see the project-wide impact of all your decisions at a glance.

Use these charts to get a quick sense of whether the treatments you have applied make a meaningful difference at the project level, not just for individual segments.

> **v2 layout:** This section is shown as **Before/After "Overall Risk Level" cards** — stacked horizontal risk-band bars per crash type, with the same hover detail (count and percentage) as the equivalent Path Analysis and Coding charts — instead of pie charts. The underlying data and per-tab (All Projects / specific project) behaviour is identical.

---

### Tips and common workflows

- **Pre and Post tagging** — if you are working with a before-and-after survey pair, tag one project `Pre` and the other `Post`, then load both together. You can then compare the actual post-treatment survey against PSAT's predicted improvement.
- **Applying a single improvement across a whole project** — switch to **By Treatment** view, find the treatment you want, tick it, then click Apply. The confirmation dialog will list all eligible segments; confirm to apply in bulk.
- **Undoing all changes** — if you want to start fresh, navigate to each segment that has been treated and click Reset to remove treatments one segment at a time, or use the on-canvas **Reset All** button (v2) / sidebar **Reset All** (v1) to reset every applied treatment across the loaded project(s) in one action.
- **Checking what was already applied** — treatments that have already been saved for the current segment are shown with a **green background** in the Treatment Options panel, so you can see at a glance what is already in place.

---

### 4.10 AI Score Preview — Before & After Treatment

When you select treatments in the Treatment Options panel, PSAT calculates a **predicted score** for the current segment in real time. This before/after comparison lets you evaluate the safety impact of a treatment before committing to it.

#### How the Before / After Comparison Works

1. **Before score** — the original crash type scores (BB, BP, SB, VB, Risk Score) computed from the coded attributes.
2. **Treatment selected** — ticking a treatment checkbox immediately previews the effect on the current segment's scores.
3. **After score** — PSAT re-runs the CycleRAP scoring formula with the updated attribute values to produce a predicted post-treatment score.

The difference (reduction) is shown as a **↓ value** beneath each crash type score card. A green indicator confirms improvement; no arrow means the treatment did not affect that crash type.

#### Reading the Score Cards

When treatments are selected:

- Each card shows the **post-treatment score** in large text.
- A **↓ X.XX** delta beneath it shows how much the score decreased.
- The card background colour reflects the **post-treatment band** — if a treatment moved a segment from High to Medium, the card will show the Medium (yellow/orange) colour.

#### Previewing Before You Apply

> [!IMPORTANT]
> Ticking any treatment checkbox automatically shows the **live score preview** for the current segment in the Scores card — no toggle needed. The **Show Pre-Treatment** toggle (in the Attributes panel header, **on by default**) lets you switch back to the original pre-treatment scores and attributes at any time; switch it off to see the post-treatment attribute values alongside the preview scores.

Tick any treatment checkbox to see the **live score preview** for the current segment. The scores update automatically as you change your selection — you do not need to click Apply. To also see which attribute values would change, switch off **Show Pre-Treatment**.

> **Note:** Selecting treatments only previews the effect — nothing is saved until you click **Apply**.
