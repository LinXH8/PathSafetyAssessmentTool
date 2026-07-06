# 5. Report Generation

## Overview

The **Report Builder** compiles a formatted, printable report of your path safety assessment. It pulls live data from the projects you have loaded in the Path Analysis page, reflecting your active filters and selected segments.

Access it from the **sidebar** on the Path Analysis or Treatment page.

---

## Table of Contents

- [5.1 Navigation and Toolbar](#51-navigation-and-toolbar)
- [5.2 Report Sections Panel](#52-report-sections-panel)
- [5.3 Include Filtered Sections](#53-include-filtered-sections)
- [5.4 Report Section Reference](#54-report-section-reference)
  - [5.4.1 Title and Report Name](#541-title-and-report-name)
  - [5.4.2 Summary](#542-summary)
  - [5.4.3 Map](#543-map)
  - [5.4.4 Risk Bands](#544-risk-bands)
  - [5.4.5 Risk Factors](#545-risk-factors)
  - [5.4.6 Project Details](#546-project-details)
  - [5.4.7 Top Risk Stretches](#547-top-risk-stretches)
  - [5.4.8 Benchmarking Stats](#548-benchmarking-stats)
  - [5.4.9 Treatments](#549-treatments)
- [5.5 Saving, Exporting and Reusing Your Report](#55-saving-exporting-and-reusing-your-report)
- [5.6 Saved Reports](#56-saved-reports)
- [5.7 Quick-start Steps](#57-quick-start-steps)

---

## 5.1 Navigation and Toolbar

The top toolbar gives you page navigation, layout controls, and export:

| Control | What it does |
|---|---|
| **← Back** | Return to the previous page |
| **↗ Path Analysis** | Jump directly to the Path Analysis page to change projects or filters, then return here |
| **Auto-fit** | Automatically adjusts section spacing to fit the page cleanly |
| **Save layout** | Saves your current section order, visibility, and field values to the browser |
| **Reset layout** | Resets section order and visibility to the default |
| **◀ Page N / Total ▶** | Navigate between report pages in the preview |
| **↓ PDF** | Export the report as a PDF |
| **↓ Word** | Export the report as a Word (.docx) file |

> Your layout, section order, editable text (report title, OIC, purpose, dates), and visibility settings are **auto-saved to your browser**. Use **Save layout** to persist them explicitly, and **Reset layout** to start over.

---

## 5.2 Report Sections Panel

The **Report Sections** panel on the left lists every available report block. You can:

- **Drag** the `⠿` handle on any row to reorder sections
- **Check / uncheck** the checkbox on any row to show or hide that section in the report

Default visibility (as shown in the panel):

| Section | On by default |
|---|---|
| Title | ✅ |
| Summary | ✅ |
| Map | ✅ |
| Benchmarking Stats | ☐ |
| Risk Bands | ✅ |
| Risk Factors | ✅ |
| Project Details | ✅ |
| Top Risk Stretches | ✅ |
| Treatments | ✅ |

---

## 5.3 Include Filtered Sections

The **Include filtered sections** checkbox at the top of the Report Sections panel enables a filtered copy of the report.

> **How it works:** Apply a filter on the Path Analysis page first (e.g. filter by a specific attribute or road type), then check this box. The report will render only the segments that matched your active filter, giving you a focused subset view rather than the full project.

Leave this unchecked (default) to include all loaded segments.

---

## 5.4 Report Section Reference

### 5.4.1 Title and Report Name

The title page includes:

- **Report title** — click the heading text inline to rename it (e.g. "Path Safety Assessment Executive Summary")
- **Projects** — shows the project(s) loaded from Path Analysis; click × to remove a project
- **OIC IN-CHARGE** — type the officer or team responsible for the report
- **PURPOSE** — brief statement of why the assessment was conducted
- **REPORT DATE** — defaults to today; click to change via the date picker
- **IMAGE DATE** — the date the survey images were captured; populated automatically from project data where available

**Report Name (auto-generated):** When you generate a report, the system assigns an automatic report name based on the **default risk score band** of the loaded project(s) (e.g. "High Risk Assessment — Ang Mo Kio"). If you have an active filter applied in the Path Analysis page, the report name will instead reflect the **filtered selection** — the filtered name takes precedence over the default risk score label. You can always click the heading to override the name manually.

### 5.4.2 Summary

Shows headline statistics for the loaded project(s):

- **Projects** — count of loaded projects
- **Total Segments** — total number of segments across all loaded projects
- **km Total Length** — total path length in kilometres

This section renders automatically when projects are loaded.

### 5.4.3 Map

A live route map showing every segment as a colour-coded dot, coloured by **Overall Risk Level Band**:

- 🟢 Green — Low
- 🟡 Yellow — Medium
- 🟠 Orange — High
- 🟣 Purple — Extreme

The map zooms to fit all loaded segments. It is interactive in the preview but captured as a static image in PDF/Word exports.

A **legend** is displayed alongside the map, showing the colour coding for each risk band so that readers of the exported report can interpret the segment colours without additional context.

### 5.4.4 Risk Bands

**What it shows:** The distribution of segments across risk bands (Low / Medium / High / Extreme) for all **five risk types**: Overall Risk, Vehicle–Bicycle (VB), Bicycle–Bicycle (BB), Single-Bicycle (SB), and Bicycle–Pedestrian (BP).

**How it looks:** Five donut charts (Overall, VB, BB, SB, BP), one per risk type, each showing how many segments fall into each band out of the total segment count, with segment count and percentage. The colour coding is:

- 🟢 Low — green
- 🟡 Medium — yellow
- 🟠 High — orange
- 🟣 Extreme — purple

This section renders automatically once your projects are loaded — no manual steps required.

> **Tip:** The Risk Bands section reflects your **active filters**. If you have filtered the Path Analysis page to only show certain segments (e.g. by road type or rating), only those segments appear in the bands.

### 5.4.5 Risk Factors

Shows which attributes are contributing most to risk scores across the loaded segments. This section identifies the top-scoring risk attributes in aggregate, helping prioritise which factors to address with treatments.

### 5.4.6 Project Details

Displays project-level metadata including project name, source road, creation and update dates, and other administrative details for each loaded project. **Entries are sorted by severity — projects with the highest overall risk scores appear first**, making it easy to prioritise which projects require the most urgent attention.

### 5.4.7 Top Risk Stretches

Lists the highest-scoring segments ranked from worst to best, with images, scores, contributing factors, and any treatments applied.

**Top N selector:** Choose how many segments to include — **3**, **5**, or **10** (default is 10). The selector appears directly below the section row in the Report Sections panel.

Each segment card shows:

| Element | Description |
|---|---|
| **Ranking badge** | Numbered circle (1 = worst) |
| **Survey image** | Actual photo of that location |
| **Project name** | Which project the segment belongs to |
| **Risk Score** | Combined score (colour = band) |
| **Top Contributing Attribute** | The attribute contributing most to the risk score |
| **Other significant factors** | Additional contributing attributes |
| **Applied Treatments** | Green box listing any treatments applied to this segment |
| **Crash type breakdown** | VB / BB / SB / BP scores and their individual band colours |

> Contributing factors are derived from the **CycleRAP scoring multipliers**. Each attribute that raises the risk score is listed with how much it contributed.

**Pasting AI-generated after images:**

For each top-risk segment, the survey photo is shown as the *before* image. To add an AI-generated *after* image:

1. In the **Treatment Page**, use the **AI Prompt** feature to generate an after-treatment visualisation.
2. Copy the AI-generated image to your clipboard.
3. In the Report Builder, click the image area of the relevant segment.
4. Press **Ctrl+V** to paste — the AI image replaces the survey photo for that segment in the export.

### 5.4.8 Benchmarking Stats

Compares the current project(s) against **all other verified projects** in the system — showing min, average, and max scores for each crash type across the verified pool.

| Column | Meaning |
|---|---|
| **Min** | Lowest score seen across all verified projects |
| **Avg** | Average score across verified projects |
| **Max** | Highest score seen across verified projects |
| **Your project** | The current project's average score (highlighted) |

A project is included in the benchmark pool only if it has been **verified** (Verified toggle on in the Projects page). This section is **off by default** — check it in the Report Sections panel to include it.

### 5.4.9 Treatments

Lists all treatments applied across the loaded project(s) — showing each treatment type and how many segments received it.

Treatments must be applied first in the **Treatment Page** before they appear here. Use the **↗ Path Analysis** shortcut or **← Back** to navigate to Treatment and return.

---

## 5.5 Saving, Exporting and Reusing Your Report

| Action | How |
|---|---|
| **Save layout** | Click **Save layout** in the toolbar to persist section order, visibility, and field values to the browser |
| **Hard Save** | Use **Save Report** to permanently save the report to the system — it will persist across sessions and can be revisited at any time |
| **Reset layout** | Click **Reset layout** to restore the default section order and visibility |
| **Export as PDF** | Click **↓ PDF** — renders the current preview sliced into pages |
| **Export as Word** | Click **↓ Word** — generates a `.docx` file suitable for editing in Microsoft Word |

> **Hard Save vs. Layout Save:** *Save layout* stores your preferences locally in the browser only (cleared if you clear browser data). *Hard Save* writes the report to the server so you can return to it from any device or session.

---

## 5.6 Saved Reports

A **Saved Reports** list shows all reports that have been hard-saved for your projects. From this list you can:

- **Browse** previously saved reports, shown with their report name, associated project(s), and the date last saved
- **Open** any saved report to reload it in the Report Builder — your section layout, field values, and visibility settings are restored exactly as saved
- **Re-export** a revisited report to PDF or Word without rebuilding it from scratch
- **Delete** a saved report you no longer need

> Saved reports capture a snapshot of the data at the time of saving. If you update project data or re-code segments after saving, re-open the report and save again to refresh it.

---

## 5.7 Quick-start Steps

1. Load your projects in the **Path Analysis** page; apply any filters you need.
2. Open **Report Builder** from the sidebar.
3. Fill in the **Title** fields: report title (click heading to edit), OIC IN-CHARGE, PURPOSE, REPORT DATE, IMAGE DATE. The report name is auto-generated from the risk score band; if a filter is active, the filtered name takes precedence.
4. In the **Report Sections** panel, check/uncheck sections and drag to reorder as needed.
5. Set **Top Risk Stretches** to your preferred Top N (3, 5, or 10).
6. (Optional) Check **Include filtered sections** if you want a filtered-subset report.
7. (Optional) Paste AI-generated after images into top-risk segment image areas.
8. Click **Save Report** (hard save) to persist the report for future revisiting, or go straight to **↓ PDF** / **↓ Word** to export.
