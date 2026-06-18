# 6. Report Generation

## Overview

The **Report Builder** compiles a formatted, printable report of your path safety assessment. It pulls live data from the projects you have loaded in the Path Analysis page, so your active filters and selected segments are reflected automatically.

Access it from the **sidebar** while on the Path Analysis page, or from the Treatment page — click **"Generate Report"** or **"Continue Report"** (if you have a saved layout).

> Your report layout, section titles, and editable text fields are **auto-saved to your browser**. If you close the tab and come back, click **Restore Saved** to pick up where you left off.

---

## How the Report is Structured

The report is built as a vertical stack of **sections** (blocks). Each section renders on an A4-proportioned canvas. You can:

- **Drag** sections up or down to reorder them
- **Show / hide** any section using the toggle on its right edge
- **Rename** any section title by clicking on the title text inside the section
- **Export as PDF** or **Export as Word (.docx)** using the top toolbar buttons

The default page order is:

| Page | Sections included |
|------|-------------------|
| 1 | Title, Summary, Map |
| 2 | Risk Bands, Benchmarking Stats, Top Risk Stretches |
| 3 | Treatments |
| Off by default | Project Details, Risk Factors |

---

## Section 1 — Project Details (Title Page)

**What it shows:** Project name(s), image survey date, report date, officer-in-charge, and purpose of the report.

**Where it appears:** The **Title** section at the top of page 1.

### How to fill it in

1. In the **top toolbar**, locate the editable fields:
   - **Report Title** — click to type your own title (e.g. "Toa Payoh Path Safety Report 3Q25").
   - **OIC Name** — officer or team responsible for the report.
   - **Purpose** — brief statement of why the assessment was conducted.
   - **Report Date** — defaults to today; click to change.
   - **Image Date** — the date the survey images were taken; click to type (e.g. "Sep 2025").
2. Click **outside** a field or press **Enter** to confirm each change.
3. In the Title section itself, click on the large title text to rename it inline.

**How it looks in the report:** A header block showing the report title in large text, with the project name(s), survey date, report date, officer name and purpose listed below it.

> **Project names** shown in the report come from whichever projects you loaded into the Path Analysis page. To load projects, return to the Path Analysis page and select projects, then come back to the Report Builder.

---

## Section 2 — Overall Project Risk Scores (Risk Bands)

**What it shows:** The distribution of segments across risk bands (Low / Medium / High / Extreme) for all **five risk types**: Vehicle–Bicycle (VB), Bicycle–Bicycle (BB), Single-Bicycle (SB), Bicycle–Pedestrian (BP), and Overall Risk.

### How to use it

1. The **Risk Bands** section renders automatically once your projects are loaded. No manual steps required.
2. Each crash type is shown as a **horizontal bar chart**: one bar per band, with segment count and percentage.
3. The colour coding is:
   - 🟢 **Low** — green
   - 🟡 **Medium** — yellow
   - 🟠 **High** — orange
   - 🟣 **Extreme** — purple

**How it looks:** Five stacked bar charts (VB, BB, SB, BP, Overall), one per crash type. Each bar shows how many segments fall into each risk band out of the total segment count.

> **Tip:** The Risk Bands section reflects your **active filters**. If you have filtered the Path Analysis page to only show certain segments (e.g. by road type or rating), only those segments appear in the bands.

---

## Section 3 — Project Analysis Report (Map + Summary + Top Segments)

This is split across three sub-sections that together form the full analysis report.

### 3a — Summary

**What it shows:** Total segment count, active filter summary, and the project(s) included.

1. Loads automatically when projects are selected.
2. If you have filters active on the Path Analysis page, the filter names appear here to record exactly what was analysed.

### 3b — Map

**What it shows:** A live route map with every segment plotted as a colour-coded dot, matching the risk band colours above.

1. The map renders automatically from your project geodata.
2. Segments are coloured by their **Overall Risk Level Band**.
3. The map zooms to fit all loaded segments.

> The map is interactive in preview but is captured as a static image in the PDF/Word export.

### 3c — Top Risk Stretches

**What it shows:** The highest-scoring segments ranked from worst to best, with images, scores, contributing factors, and any treatments applied.

#### How to configure

1. In the **Top Risk Stretches** section, use the **View** toggle at the bottom:
   - **Full Page** — one segment per page, large image + full detail (recommended for reports).
   - **Grid** — compact card grid (3 per row).
   - **Tabular** — compact table with thumbnails.
2. Use the **Top N** selector to choose how many segments to show: 3 to 10 (default is **10**).

#### What each segment card shows (Full Page view)

Each of the top 10 segments gets its own full page with:

| Element | Description |
|---------|-------------|
| **Ranking badge** | Large numbered circle (1 = worst) |
| **Survey image** | Actual photo of that location |
| **Project name** | Which project the segment belongs to |
| **Risk Score** | Combined score (large number, colour = band) |
| **Top Contributing Attribute** | The single attribute contributing most to the risk score, with its multiplier value |
| **Other significant factors** | Up to 4 additional contributing attributes |
| **Applied Treatments** | Green box listing any treatments already applied to this segment |
| **Crash type breakdown** | VB / BB / SB / BP scores and their individual band colours |

> Contributing factors are identified from the **CycleRAP scoring multipliers** — each attribute that raises the risk score is listed with how much it contributed (shown as a negative number, e.g. −3.5).

---

## Section 4 — Project Treatment Report (Before & After)

**What it shows:** Which treatments were applied across the project(s) and a summary of how many segments were treated per treatment type.

### How the before/after works

1. Treatments must first be applied in the **Treatment Page** (accessed from the sidebar on the path analysis or projects page).
2. After applying treatments and returning to the Report Builder, the **Treatments** section lists:
   - Each treatment type (e.g. "Install street lighting", "Widen the facility").
   - How many segments received each treatment.
3. The **Top Risk Stretches** section (above) shows the **Applied Treatments** box on each segment card — this is the "after" side of the before/after comparison. The segment image shown is the **before** survey photo.

### Pasting AI-generated "after" images

For each of the top 10 segments, the report shows the real survey photo as the **before** image. To add an AI-generated **after** image showing what the location could look like post-treatment:

1. In the **Treatment Page**, use the **AI Prompt** feature to generate an after-treatment visualisation for that segment.
2. **Copy** the AI-generated image to your clipboard (right-click → Copy Image, or use the copy button if available).
3. In the Report Builder, open the top risk segment you want to update.
4. **Paste** the image directly into the segment image area — click the image area once to select it, then press **Ctrl+V**.
5. The pasted AI image replaces the survey photo for that segment in the report export.

> Currently the paste-in feature works in **Full Page** view mode. Ensure you are in Full Page mode before pasting.

---

## Section 5 — Benchmarking (Verified Projects)

**What it shows:** How the current project(s) compare against **all other verified projects** in the system — showing min, average, and max scores for each crash type across the verified set.

### How to read it

| Column | Meaning |
|--------|---------|
| **Min** | Lowest score seen across all verified projects |
| **Avg** | Average score across verified projects |
| **Max** | Highest score seen across verified projects |
| **Your project** | The current project's average score (highlighted) |

The five rows are: VB, BB, SB, BP, and Overall Risk.

### How benchmarking works

1. A project is included in the benchmark pool only if it has been **verified** (the Verified toggle in the Projects page must be on).
2. The benchmarking section loads automatically — no extra steps needed.
3. Use this to see whether your project's risk scores are above or below typical values for similar paths in the dataset.

> If no other verified projects exist in the system, the benchmarking section will show only your current project's data.

---

## Saving, Exporting and Reusing Your Report

### Save your layout
Click **Save Layout** in the toolbar. Your section order, section titles, all editable text (report title, OIC, purpose, dates), and any customisations are saved to the browser.

### Export as PDF
Click **Export PDF**. The report renders exactly as shown in the preview, sliced into A4 pages. Each section begins on a clean page boundary.

### Export as Word (.docx)
Click **Export Word**. A `.docx` file is generated with the same content, suitable for further editing in Microsoft Word.

### Restore a previous layout
Click **Restore Saved** on the toolbar to reload a layout you saved earlier in the same browser.

### Reset to default
Click **Reset** to clear all customisations and return to the default section layout.

---

## Quick-start Steps

1. **Load your projects** in the Path Analysis page; apply any filters you need.
2. **Open Report Builder** from the sidebar ("Generate Report").
3. Fill in the **Title toolbar fields**: Report Title, OIC Name, Image Date, Report Date, Purpose.
4. Toggle sections **on/off** as needed; drag to reorder.
5. Set **Top Risk Stretches** to **Full Page**, **Top 10**.
6. (Optional) Paste AI-generated after images into segment image areas.
7. Click **Export PDF** or **Export Word**.
