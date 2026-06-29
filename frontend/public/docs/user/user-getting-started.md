# Path Safety Assessment Tool (PSAT) User Guide

Welcome to PSAT. The tool helps you create projects from geotagged survey images, review coded path segments, calculate safety risk scores, analyse safety hazards and test treatments.

---

## Table of Contents

- [1.0 How to Install PSAT](#10-how-to-install-psat)
- [1.1 Using the Help Guide](#11-using-the-help-guide)
- [1.2 User Login & Account Management](#12-user-login--account-management)
- [1.3 Open the Project List](#13-open-the-project-list)
- [1.4 Create a Project](#14-create-a-project)
- [1.5 Navigate Between Workflows](#15-navigate-between-workflows)
- [1.6 Viewing and Updating GIS Layers](#16-viewing-and-updating-gis-layers)

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

### 1.3 Open the Project List

Use the **Home** page to browse all projects. You can:

- search by project name or road name
- filter by tags (e.g. NSC, AMK)
- sort by project name, verification progress, distance verified, autocode progress, and last modified time
- select one or more projects for deletion, coding, path analysis, or treatment work

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

### 1.5 Navigate Between Workflows

From the project list, you can send selected projects for the following:

| Workflow | Purpose |
|---|---|
| **Delete Project** | Housekeeping to remove unwanted projects |
| **Coding** | Detailed attribute review and saving |
| **Analyse Projects** | Multi-project filtering, charts, generate reports and export data, images, shp files |
| **Treatment Application** | Before/after scenario testing |

### 1.6 Viewing and Updating GIS Layers

Click **View GIS Layers** from the sidebar to open the GIS Layers dashboard, where you can browse, filter, rename, and update the spatial data layers that power PSAT's auto-coding.

> For full instructions on adding, replacing, filtering, and renaming layers, see [Section 6: GIS Layer Management](#6-gis-layer-management).
