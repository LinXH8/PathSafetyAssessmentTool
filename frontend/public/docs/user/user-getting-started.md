# Path Safety Assessment Tool (PSAT) User Guide

Welcome to PSAT. The tool helps you create projects from geotagged survey images, review coded path segments, calculate safety risk scores, analyse safety hazards and test treatments.

---

## Table of Contents

- [1.1 Using the Help Guide](#11-using-the-help-guide)
- [1.2 User Login](#12-user-login)
- [1.3 Open the Project List](#13-open-the-project-list)
- [1.4 Create a Project](#14-create-a-project)
- [1.5 Navigate Between Workflows](#15-navigate-between-workflows)
- [1.6 Viewing and Updating GIS Layers](#16-viewing-and-updating-gis-layers)

---

## 1. Getting Started

### 1.1 Using the Help Guide

Click the **Help (?)** button at the top left corner of any page to open the in-app guide. The Help page contains three tabs:

- **User Guide** — step-by-step instructions for all workflows (this guide)
- **Admin Guide** — system deployment, model management, and infrastructure
- **Developer Guide** — technical architecture, API reference, and scoring logic

### 1.2 User Login

When you open PSAT, the **Landing Page** lists every profile registered on this device.

1. Click your profile card — it highlights in green to show it is selected.
2. Click **Start As \<Name\>**. A PIN prompt appears if this is not the currently active session.
3. Enter your 4–12 digit numeric PIN and confirm.
4. You are now logged in and taken to your **Projects** page.

To create a new profile, click **Create Profile**, enter your LTA Employee Email, Division, and a 4–12 digit numeric PIN, then click **Create Profile**.

To switch accounts, click **Log Out** in the left-hand sidebar and select a different profile on the Landing Page.

> For full login and account management instructions, see [Section 2: User Login & Account Management](#2-user-login--account-management).

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

### 1.5 Navigate Between Workflows

From the project list, you can send selected projects for the following:

| Workflow | Purpose |
|---|---|
| **Delete Project** | Housekeeping to remove unwanted projects |
| **Coding** | Detailed attribute review and saving |
| **Analyse Projects** | Multi-project filtering, charts, generate reports and export data, images, shp files |
| **Treatment Application** | Before/after scenario testing |

### 1.6 Viewing and Updating GIS Layers

Click **View GIS Layers** from the sidebar to open the GIS Layers dashboard.

From the GIS Layers page you can:

- Browse all current GIS layers (sorted in alphabetical order)
- View last updated date, required columns, and metadata for each layer
- **Filter shapefiles** — type any keyword into the filter box beside the "Available Shapefiles" heading to instantly narrow the list to matching layers. This is useful when you have many layers and want to jump straight to the one you need (e.g. type `bus` to surface all bus-related layers)
- **Rename a layer** — click **Edit** next to any shapefile to give it a custom display name that is meaningful to your team. The rename takes effect immediately across the dashboard
- **Revert to original name** — if a layer has been renamed, click **Revert** to restore its original filename at any time
- Using the **Update GIS Layer** button:
  - **Add** entirely new GIS layers for new categories
  - **Replace** an existing layer with an updated file
  - **Delete** a layer that is no longer needed

> For full GIS layer management instructions, see [Section 8: GIS Layer Management](#8-gis-layer-management).
