## 4. Treatment Application

The Treatment Application page lets you test safety improvements on one or more cycling path projects. You can explore which interventions apply to each segment, preview how they would change risk scores, apply them, and compare before-and-after risk distributions — all without permanently altering the underlying survey data until you are ready.

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
> The **Show Post-Treatment** toggle (located in the Attributes panel header on the right) must be switched **on** to see the live preview of the post-treatment risk scores and attribute changes. Switching it back to **Show Pre-Treatment** correctly restores the original (pre-treatment) scores and attributes — the score display refreshes automatically in both directions.

Once the **Show Post-Treatment** toggle is enabled, selecting a treatment will show a **live preview** in the **Scores card** on the right of what the risk scores would look like if you applied those treatments to the current segment. The preview updates automatically whenever you change your selection — you do not need to click anything to trigger it.

With the toggle on, the attributes panel also updates to display exactly which attribute values would change if the selected treatments were applied, so you can understand the reasoning behind the score change.

> **Note:** Selecting treatments only previews the effect — nothing is saved until you click Apply.

---

### Step 5: Apply treatments

When you are satisfied with your selection, click **Apply (N)** at the bottom of the Treatment Options panel (where *N* is the number of treatments selected):

- **In By Segment mode**, Apply saves the selected treatments for the current segment only. The treatment colours on the After Treatment map will update for that segment immediately.
- **In By Treatment mode**, Apply triggers a confirmation dialog listing each selected treatment and asking whether to apply it to **all eligible segments** across the loaded project. Confirm to apply in bulk, or cancel to go back.

If you change your mind about an applied treatment on the current segment, click the **Reset** button that appears for that treatment to remove it and restore the original scores for that segment.

---

### Step 6: Read the segment image, scores, and attributes

The **middle column** shows the street-level photograph for the current segment. Use **Previous** and **Next** to move through segments, or jump to a specific page number.

The **right column** shows two panels:

- **Segment Scores** — displays the four CycleRAP risk scores for the current segment: Vehicle-Bicycle (VB), Bicycle-Pedestrian (BP), Single-Bicycle (SB), and Bicycle-Bicycle (BB). When treatments are selected, this panel shows the previewed scores alongside the original scores so you can compare.
- **Attributes panel** — lists all coded attribute values for the current segment. Toggle **Show Post-Treatment** to switch between the original coded values and the values that would result from the selected treatments.

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

Use **Copy Selected** when you are exploring options and want to preview the AI image before committing. Use **Copy Applied** when you have already applied treatments and want to generate the final before-and-after visualisation.

---

### Step 9: Review the Overall Treatment Analysis

Scroll to the bottom of the page to see the **Overall Treatment Analysis** section. It shows two rows of five pie charts each — one row for **Before Treatment** and one for **After Treatment**:

- Each pie chart covers one crash type: **Overall**, **Vehicle-Bicycle (VB)**, **Bicycle-Pedestrian (BP)**, **Single-Bicycle (SB)**, and **Bicycle-Bicycle (BB)**.
- Each chart shows how the segments in the loaded project are distributed across the four risk bands (Low, Medium, High, Extreme).
- The After Treatment row updates as you apply treatments, so you can see the project-wide impact of all your decisions at a glance.

Use these charts to get a quick sense of whether the treatments you have applied make a meaningful difference at the project level, not just for individual segments.

---

### Tips and common workflows

- **Pre and Post tagging** — if you are working with a before-and-after survey pair, tag one project `Pre` and the other `Post`, then load both together. You can then compare the actual post-treatment survey against PSAT's predicted improvement.
- **Applying a single improvement across a whole project** — switch to **By Treatment** view, find the treatment you want, tick it, then click Apply. The confirmation dialog will list all eligible segments; confirm to apply in bulk.
- **Undoing all changes** — if you want to start fresh, navigate to each segment that has been treated and click Reset to remove treatments one segment at a time.
- **Checking what was already applied** — treatments that have already been saved for the current segment are shown with a **green background** in the Treatment Options panel, so you can see at a glance what is already in place.

---



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
> The **Show Post-Treatment** toggle must be switched **on** in the Attributes panel header to see the live score preview and attribute modifications. Switching it back to **Show Pre-Treatment** correctly restores the original pre-treatment scores — the display refreshes automatically in both directions.

With the toggle enabled, tick any treatment checkbox to see the **live score preview** for the current segment. The scores and attributes update automatically as you change your selection — you do not need to click Apply.

> **Note:** Selecting treatments only previews the effect — nothing is saved until you click **Apply**.

#### AI-Assisted Visualisation (Prompt & Image Copy)

There are **two separate buttons** — one for the prompt and one for the image — because pasting both simultaneously into tools such as Gemini is not supported. Copy and paste each independently:

- **Copy prompt** — copies a ready-to-use text prompt describing the selected or applied treatments. Prompt templates have been updated for clearer, more accurate visualisation instructions. Use the dropdown to choose:
  - **Copy Applied** — prompt based on treatments already **applied and saved** for this segment.
  - **Copy Selected** — prompt based on treatments currently **ticked/selected** in the panel.

- **Copy image** — copies the current segment photograph to your clipboard as a standalone action. Attach it to the AI tool separately from the prompt.

Use **Copy Selected** when exploring options before committing. Use **Copy Applied** when generating the final before-and-after visualisation.
