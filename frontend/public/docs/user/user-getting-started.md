# Path Safety Assessment Tool (PSAT) User Guide

Welcome to PSAT. The tool helps you create projects from geotagged survey images, review coded path segments, calculate safety risk scores, analyse safety hazards and test treatments.

> **New in 2026-07-02 — the v2 interface is now the default.** The Home, Create Project, Coding, Path Analysis, Treatment Application, User Guide, and GIS Layers pages all open in the redesigned **v2** layout by default. This guide describes the app as it appears in v2 unless a section says otherwise. If a page still shows the older layout, or you want to compare, add `?ui=v1` to the page's URL (`?ui=v2` switches back) — your choice is remembered on this device until you change it again. The **Report Builder** and **Generated Reports** pages keep their existing v1 layout for now, with only minor visual touch-ups applied (see [Section 5: Report Generation](../user-report-generation.md)); the **Landing (login) page**'s branded look is unchanged aside from its profile pop-ups (see [Section 1.2](#12-user-login--account-management)).

---

## Table of Contents

- [1.0 How to Install PSAT](#10-how-to-install-psat)
- [1.1 Using the Help Guide](#11-using-the-help-guide)
- [1.2 User Login & Account Management](#12-user-login--account-management)
- [1.3 Open the Project List](#13-open-the-project-list)
- [1.4 Create a Project](#14-create-a-project)
- [1.5 Navigate Between Workflows](#15-navigate-between-workflows)
- [1.6 Quick Select — Jump to a Workflow from Anywhere](#16-quick-select--jump-to-a-workflow-from-anywhere)
- [1.7 Viewing and Updating GIS Layers](#17-viewing-and-updating-gis-layers)
- [1.8 Sharing a Project](#18-sharing-a-project)

---

## 1. Getting Started

### 1.0 How to Install PSAT

> **Note:** This section is a placeholder. Full installation instructions will be added once the installation package is finalised by the development team.

The PSAT installation folder contains everything needed to run the tool on your machine. Key items in the folder include:

- **run.PSAT** — the main launcher executable to start the application
- **GIS layers** — all shapefiles required for auto-coding and spatial analysis
- **Latest survey images** — pre-loaded images (e.g. 1Q26) for initial project setup

Contact your administrator for the latest installation package and setup instructions.

---

### 1.1 Using the Help Guide

Click the **Help (?)** button at the top left corner of any page to open the in-app guide. The Help page contains three tabs:

- **User Guide** — step-by-step instructions for all workflows (this guide)
- **Admin Guide** — system deployment, model management, and infrastructure
- **Developer Guide** — technical architecture, API reference, and scoring logic

> **v2 layout:** The Help page itself was redesigned for v2 — a single unified canvas with the three guides as tab pills at the top, a slim left-hand section list showing only a "Last updated" caption instead of a date on every entry, and the standard v2 sidebar down the left of the screen. The content and structure of each guide are unchanged.

### 1.2 User Login & Account Management

**Creating a new profile** — click **Create Profile** on the Landing Page and fill in the following:

- **Username** — a display name for your profile (shown on the landing page and in session headers)
- **LTA Employee Email** (e.g. `user@lta.gov.sg`) — this is your **private-facing email**, used only for identity verification and password/PIN recovery; it is not displayed publicly
- **Division** — your organisational division
- **4–12 digit numeric PIN** — your login credential

Then click **Create Profile** to complete setup.

**Signing in** — click your profile card on the Landing Page, click **Start As \<Username\>**, enter your PIN, and you are taken to your **Projects** page.

**Switching accounts** — click **Log Out** in the left-hand sidebar at any time and select a different profile on the Landing Page.

**Session Behaviour**

- Sessions are **device-local**. All browser tabs open on the same device share the same active profile.
- Logging out from one tab logs you out everywhere on that device.
- Your projects, images, and results persist on disk — logging out does not delete any data.

**Forgotten PIN / Restore Password**

If you have forgotten your PIN, you can restore access using your registered **private-facing email**:

1. On the Landing Page, click **Forgot PIN?** (or the equivalent restore option) below the sign-in prompt.
2. Enter the **email address** you provided when creating your profile.
3. Follow the verification instructions sent to that email to reset your PIN.

> If you no longer have access to your registered email, ask your administrator to delete and recreate the profile. Note that deleting a profile removes all projects associated with it.

> **What's new in v2 (2026-07-07):** The Landing Page keeps its familiar branded look — background image, PSAT logo/hero, and the green profile selection panel — but the functional pop-ups behind it were rebuilt for v2:
>
> - The **Enter PIN**, **Create Profile**, **Manage Profile**, **Delete Profile**, and **Reset PIN** dialogs all now open in a new, lighter pop-up style consistent with the rest of the v2 interface.
> - The right-hand profile panel **no longer scrolls as a whole** — only the list of profiles scrolls internally, so the **Start** button stays pinned and visible on screen no matter how many profiles are registered on the device.
> - This fixes an old issue where, on devices with many saved profiles, the Start button could be scrolled out of view.
>
> A full redesign of the branded landing layout itself (background, hero, logo) is still planned for a future update — only the profile pop-ups have moved to v2 so far.

### 1.3 Open the Project List

Use the **Home** page to browse all projects. You can:

- search by project name or road name
- filter by tags (e.g. NSC, AMK)
- sort by project name, verification progress, distance verified, autocode progress, and last modified time
- select one or more projects for deletion, coding, path analysis, or treatment work

> **What's new in v2:** The Home page is fully redesigned. A few behaviours changed along with the new look:
>
> - **Clear filters** is now a single **×** at the end of the "Search by Tags" bar (it appears once a search term or tag filter is active) instead of a separate "Clear Filters" button — it still clears the name search and every tag filter in one click.
> - The **Total Distance Verified** summary shown above the project table in v1 has been removed from the v2 action bar; per-project verified distance is still shown in the table itself.
> - The sidebar gains a **Quick Select** accordion (see [Section 1.6](#16-quick-select--jump-to-a-workflow-from-anywhere)) and, for Home specifically, a **GIS Layers** shortcut and a **Generated Reports** shortcut.
> - A new **Share** action lets you copy selected projects into another profile's account (see [Section 1.8](#18-sharing-a-project)).

### 1.4 Create a Project

Use **Create Project** when you want to build a new project from the source image folders in `in/`.

You can create a project in three ways:

1. **Single folder** — select one source folder directly
2. **Polygon / Planning Area** — draw a polygon or click a planning area on the map and create a project from multiple selected roads
3. **Upload area GIS layers** — upload area layers to define the project boundary

When creating a project:

- enter a project name without underscores
- add tags if needed (for easy grouping, e.g. NSC, AMK)
- upload images into a source folder if the folder is missing
- check that selected roads are marked as **available** before you create the project

#### Road Highlight on Source Folder Select

When you select a source folder in the Single Folder workflow, PSAT reads the road name from the folder and automatically **highlights the matching road on the map in amber/orange**. The map also pans and zooms to that road so you can visually confirm you are creating the project from the correct location before proceeding.

#### The `in/` Import Folder

The `in/` folder is the staging area for all survey images. Before you can create a project, images must be placed in a named sub-folder inside `in/`.

**Where to get the images:**
Survey images are captured using the LTA survey vehicle. The raw image files are provided by the survey team and must be copied into a named sub-folder under `in/` on the PSAT machine.

**How images are auto-named:**
Images are automatically associated with a project and quarter based on two things:

- **Project folder name** — the sub-folder name inside `in/` becomes the road name shown in PSAT (e.g. a folder named `AMK AVE 8` creates a project called **AMK AVE 8**)
- **Survey quarter** — the date embedded in each image file determines its quarter label automatically (e.g. images taken in January–March 2026 are tagged as **1Q26**)

> **Tip:** Do not use underscores in folder names — use spaces or dashes instead (e.g. `AMK AVE 8`, not `AMK_AVE_8`).

> **What's new in v2:** The Create Project page keeps the same three creation modes, but the **Single Folder** mode now shows a sortable folder table (Folder Name / Segments / Quarter / Distance / Projects) with multi-select checkboxes, and **Polygon / Planning Area** mode has a collapsible 340px Layer View panel (Roads / Planning Area switches + Import Shapefile) with the drawing tools moved into a floating cluster over the map, instead of the old per-button toolbar.

### 1.5 Navigate Between Workflows

From the project list, you can send selected projects for the following:

| Workflow | Purpose |
|---|---|
| **Delete Project** | Housekeeping to remove unwanted projects |
| **Coding** | Detailed attribute review and saving |
| **Analyse Projects** | Multi-project filtering, charts, generate reports and export data, images, shp files |
| **Treatment Application** | Before/after scenario testing |

### 1.6 Quick Select — Jump to a Workflow from Anywhere

**Quick Select** in the sidebar lets you jump straight into Coding, Path Analysis, or Treatment Application for a chosen set of projects **without first going back to the Home page**. It is available in the sidebar on every page, not just Home.

1. Click **Quick Select** in the sidebar to expand the project list.
2. Tick the projects you want to work with, or tick **All Projects** to select every project at once.
3. The **Coding**, **Path Analysis**, and **Treatment Application** buttons below become enabled as soon as at least one project is ticked.
4. Click whichever workflow you want — you are taken directly there with the ticked projects loaded, exactly as if you had selected them on the Home page.

> If you currently have unsaved changes on a Coding or Treatment page, PSAT will prompt you to save or discard them before switching, the same as navigating away any other way.

> **v2 only:** Quick Select is part of the new v2 sidebar (`SidebarV2`) and is not available in the v1 interface — in v1, use the project list on the Home page to select projects for each workflow instead.

### 1.7 Viewing and Updating GIS Layers

Click **View GIS Layers** from the sidebar to open the GIS Layers dashboard, where you can browse, filter, rename, and update the spatial data layers that power PSAT's auto-coding.

> For full instructions on adding, replacing, filtering, and renaming layers, see [Section 6: GIS Layer Management](#6-gis-layer-management).

> **What's new in v2:** The GIS Layers page has also been fully redesigned to match the rest of the v2 interface (rounded 6px cards, the v2 sidebar, and consistent tab styling) — the underlying browse/filter/rename/replace workflow described in Section 6 is unchanged.

### 1.8 Sharing a Project

Use **Share** on the Home page to give another account access to one or more of your projects.

1. Select one or more projects using the checkboxes on the left of the project table.
2. Click **Share**.
3. In the **Share to profile** dropdown, choose the account you want to share the project(s) with (any profile other than your own).
4. Click **Share** to confirm.

The selected project(s) are copied into the target profile's project list, appearing exactly as they do in yours (same coding, verification, and autocode progress). If a project with the same name already exists in the target profile, it is **skipped** rather than overwritten, and PSAT tells you how many were skipped.

> Sharing does not remove the project from your own account — both profiles have independent access to it afterwards.
