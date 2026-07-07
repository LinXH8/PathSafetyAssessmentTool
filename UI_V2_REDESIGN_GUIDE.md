# PSAT UI v2 — Frontend Contributor Guide & Standards

> **This is the standing rulebook for all frontend/UI work in PSAT.** It started as the
> brief for the v2 redesign; it is now the living document any contributor (human or Claude)
> must follow when touching the UI. If you are editing anything under `frontend/src/`, read
> **§0 first** — it is the protocol that keeps the codebase coherent.
> Worked example throughout: the **Projects page (`/home`)** pilot.
> Last updated: 2026-07-03.

---

## 0. Contributor protocol & standards — READ THIS FIRST

**Why this section exists:** the v2 UI is built on one architecture and one design system.
Most damage comes not from big rewrites but from small, well-meaning drive-by changes — a
button dropped straight into a layout, a hardcoded hex, a bespoke switch, an `onClick` that
calls an API directly. Each one is individually harmless and collectively turns the codebase
back into spaghetti. **Follow these rules; they are not optional, and "it's just a small
change" is exactly the case they exist for.**

### The ten rules

1. **The container/shell seam is law.** Every redesigned page is a *container* (the page
   file, e.g. `treatmentDetailPage.tsx`) that owns ALL logic — data fetching, hooks,
   `useState` for server data, sessionStorage, `projectDataCache`, every callback — and
   assembles them into one typed **view-model** (`*ViewModel.ts`). The *shell* (`*LayoutV2.tsx`)
   is a **pure function of that view-model**. See §3.

2. **A shell may never fetch, own server state, or touch sessionStorage.** If a shell reaches
   for `fetch`, `useState` holding backend data, `sessionStorage`, or `projectDataCache`, it is
   in the wrong layer. Local *presentational* state (an accordion's open/closed, a hovered bar)
   is fine; anything that survives a remount or hits the network belongs in the container.

3. **Never "just add a button."** A new control must call a **view-model callback** (or dispatch
   an established `window` event: `psat:save`, `psat:discard`, `psat:autocode:one`,
   `psat:autocode:by-field`, `psat:treat:all:completed`, …). If the callback doesn't exist yet,
   **add it to the container and the `*ViewModel.ts` interface**, then consume it in the shell.
   An inline `onClick` that navigates, calls an API, or mutates state directly bypasses the seam
   and the cross-page contracts — it will cause the exact bugs catalogued in root `CLAUDE.md`.

4. **Reuse the shared primitives; do not reinvent chrome.** Canonical implementations live in
   `frontend/src/pages/PathAnalysisPage/components/paV2Primitives.tsx`
   (`V2Switch`, `V2Segmented`, `v2TabStyle`, `v2TabRowStyle`, `v2CardStyle`, `AccordionSection`,
   `DistTooltipBox`) and `frontend/src/features/ui/designTokens.ts`. Use them. Do **not** hand-roll
   a toggle, tab, card, or tooltip.

5. **Tokens, never magic values.** All colour/spacing/radius/type come from `designTokens.ts`
   (`COLOR`, `FONT`, `RADIUS`, `CONTENT_PADDING`, `CATEGORICAL`), `DESIGN_GUIDE.md`, and
   `colorConstants.ts` (risk-band hues). **Never** write a raw hex (especially `#000` — darkest
   text is `#2D3748`), a bespoke font size, or a px literal that bypasses the responsive-unit
   system (§ "Sizing & Responsive-Unit Conversion Catalog"). Type/spacing/component sizes are
   `rem`; layout heights are `clamp()/vh`; hairline borders stay `1px`.

6. **Scope = colour, and it is meaningful.** Blue `#3182CE` = **local** action (acts on one
   segment/selection). Teal `#319795` = **global** action (acts on the whole project / all
   projects). A primary button's colour must match its scope. TRC chips: **pink** = By Segment,
   **grey** = By Project. Don't pick a colour for looks.

7. **Shared heavy components use the gated `variant="v2"` pattern.** When one component serves
   both UIs (`GeoDataPanel`, `AttributesPanel`, `PathAnalysisMapView`, `FilterPanel`,
   `AggregatedScoreBandPanel`, `AggregatedTopContributorsPanel`, `AttributeDistributionChart`,
   `AutocodeValidation`, `SelectRoadsMap`, `AnalysisSidebar`, `ImagePanel`), add a `variant`
   branch with **default `"v1"` that stays byte-identical**. Never fork the component and never
   regress v1 while both UIs are live.

8. **Every distribution readout uses `DistTooltipBox`.** Any hover that reveals count/% on a
   pie, bar, or stacked band renders the shared `DistTooltipBox` (bold label + `Count: N (P%)`).
   This is a documented standard (`feedback_distribution_hover_parity.md`). The native `title`
   attribute is allowed **only** for text-truncation reveals (full name on an ellipsis) and
   simple affordance hints ("Clear all filters") — **never** for a data readout.

9. **Cross-page contracts are sacred.** sessionStorage keys, `projectDataCache` invalidation,
   navigation `state` handshakes (centralised in `frontend/src/features/projectNav.ts`:
   `openCoding` / `openPathAnalysis` / `openTreatment`), and route params are load-bearing and
   documented in root `CLAUDE.md`. Do not rename, skip, or inline them — route through
   `projectNav.ts`.

10. **Unsaved-work is guarded honestly.** A page that mutates persisted data sets
    `window.psat_hasUnsavedChanges` **only when there is genuinely-unpersisted work**, and
    listens for `psat:save` / `psat:discard`. The Sidebar's `guardedAction` (route-gated) shows
    the exit dialog. Do not set the flag "just in case" — a stale flag prompts on unrelated
    pages. (Coding: attrs-vs-snapshot diff. Treatment: staged bulk selection only, because
    segment edits auto-persist — see the Treatment log entry.)

### Working discipline

- **Milestone A then B, one page at a time (§4A).** Mechanism (container hoist + verbatim v1
  extraction, byte-identical under `?ui=v1`) is reviewed *before* any design work. Commit after
  each milestone; never leave a page half-migrated in one commit.
- **Keep the typecheck clean.** Root `tsc --noEmit` must stay exit-0. (`tsc -b` has a handful of
  *pre-existing* errors in `GeoDataPanel.tsx` / `PostTreatmentImageUpload.tsx` /
  `treatmentDetailPage.tsx` — do not add to them.)
- **After code edits, run `build_or_update_graph_tool`** (incremental) to keep the knowledge
  graph in sync — per root `CLAUDE.md`, use the graph tools *before* Grep/Glob when exploring.
- **Prefer the graph, tokens, and existing primitives over new files.** New presentational
  components are fine and expected — put them in the page's `layouts/` folder and keep them
  view-model-driven.

### Current status (2026-07-03)

| Page | Route | v2 state |
|------|-------|----------|
| Projects | `/home` | ✅ **Redesigned** (pilot; established global seams) |
| Create Project | `/projects/create` | ✅ **Redesigned** |
| Path Analysis | `/analysis/path` | ✅ **Redesigned** |
| Coding | `/coding/:projectNames` | ✅ **Redesigned** |
| Treatment | `/treatment/:projectName` | ✅ **Redesigned** (+ unsaved-changes guard, 2026-07-03) |
| User Guide | `/help` | ✅ **Redesigned** |
| Report Builder | `/analysis/report` | ⚠️ **Cosmetic `isV2` only** — inline token tweaks (radius/shadow/weight), no Frame redesign |
| GIS Layers | `/gis-layers` | ⚠️ **Cosmetic `isV2` only** |
| Generated Reports | `/generated-reports` | ⚠️ **Cosmetic `isV2` only** |
| Landing Page & Profile | `/` | ❌ **Not touched** — still pure v1; first screen every user sees |

**v2 is the DEFAULT** (`resolveUiVersion()` defaults to `"v2"` since 2026-07-02). Rollback per
person: `?ui=v1`; everyone: revert the one-line default flip. The px→responsive-unit conversion
is **applied** (not just catalogued — see that section's note). v1 removal is the terminal
cleanup — **do not start it until v2 has been stable with no rollback** (§6).

> **Update — Phase 2 decomposition (July 2026).** After the redesign landed, a structural refactor
> (phases S2.1–S2.5, tracked in `REFACTOR_PLAN.md`) split each heavy **container** — which the §9 log
> below describes as one "container-only, giant file" — into a page-local `hooks/` folder (data/state)
> plus a sub-component folder, **while preserving the container/`*ViewModel.ts`/`*LayoutV1|V2` seam**.
> This does not change rule §0.1: the container still owns all logic; it now *delegates* to hooks it
> calls (which are still container-layer, never shell-layer). For new work, follow this structure:
>
> | Container | Now delegates to |
> |---|---|
> | `PathAnalysisPage/components/PathAnalysisMapView.tsx` | `components/mapView/` (`useFilterState`, `useGISLayerToggles`, `useViewportPersistence`, `MapFiltersPanel`, `SegmentsTableTab`, …) |
> | `CodingPage/components/GeoDataPanel.tsx` | `components/GeoDataPanel/` (`useGISToggleState`, `useCurvatureOverlay`, `DefectsLayer`, `MapToolCluster`, …) |
> | `CodingPage/codingPage.tsx` | `CodingPage/hooks/` (`useProjectDataCache`, `useFilterContext`, `useAutocode`, `useAttributeEditing`) |
> | `TreatmentPage/treatmentDetailPage.tsx` | `TreatmentPage/hooks/` (`useProjectMapping`, `useTreatmentEngine`, `useTreatmentState`, `useTreatmentAnalysis`) |
> | `ReportBuilderPage/reportBuilderPage.tsx` | `ReportBuilderPage/hooks/` (`useReportData`, `usePdfExport`, `useReportLayout`) + `ReportBuilderLayoutV1.tsx` shell |
>
> The API-client references throughout this guide (`../api`) are unchanged: `src/api/index.ts` is now
> a re-export barrel over per-domain modules — imports still resolve. The §9 per-page log entries
> below are **dated history**; where they say a container is one giant file, read the table above for
> its current shape.

---

## 1. What this redesign is (and isn't)

- **Is:** the *same components* (plus a few new ones) in a *new arrangement*, on the same
  routes. Plus app-global changes — a light-only theme (dark mode removed) and a restructured
  sidebar with route-specific controls moved onto each page's canvas.
- **Isn't:** a rewrite of the underlying components, and **not** a set of duplicate `/new/*`
  routes. There are no parallel routes.

### Mental model — siblings, not layers

v2 does **not** load v1 underneath and re-skin it. v1 and v2 are **interchangeable
siblings**; exactly one renders at a time. They share the **container above them**, never
each other.

```
ProjectsContainer  (logic: fetch, hooks, sessionStorage, callbacks)
        │  assembles ONE typed props object (the view-model)
        │
        ├── useUiVersion() === 'v1'  →  <ProjectsLayoutV1 {...vm} />
        └── useUiVersion() === 'v2'  →  <ProjectsLayoutV2 {...vm} />
```

Why siblings and not an overlay: an overlay leaves v1's DOM mounted (double-mounted maps,
duplicated state, CSS fights, pointer-events/modal-freeze-class bugs). Siblings mean v1's
tree simply isn't on the page in v2 mode, and "done" = delete v1 cleanly.

---

## 1A. Design source of truth (the design package)

The visual design ships as a zip — currently `temp/PSAT files.zip`. **Before starting, extract
it to a stable path** (recommended: `temp/psat-design/`) so the agent can read it. Contents and
their authority:

| File / folder | Role | How to use it |
|---------------|------|---------------|
| `DESIGN_GUIDE.md` | **Normative design system** — the single source of truth for tokens, type, spacing, components. "If a screen disagrees with this doc, the screen is wrong." | Obey it. Map its tokens to Chakra (§4). |
| `*.dc.html` (Home, Sidebar, Treatment Application, Path Analysis, User Guide) | **Visual comps** of each screen's new arrangement | Read the inline styles/structure as the layout target. **Translate to Chakra/React — do NOT port.** |
| `screenshots/` | Rendered references of the comps | Use to sanity-check the built shell against intent. |
| `assets/psat-logo.png` | Brand asset | Use where the sidebar/landing needs the logo. |
| `uploads/psat-onboarding.md` | Product/domain context | Background reading; not design-normative. |
| `support.js`, `image-slot.js`, `*.dc.html` `<script>` blocks | DC runtime (a mockup engine) | **Throwaway.** Never import or reuse; reimplement behaviour with the real container's view-model. |

### Reading the `.dc.html` comps

- They're inline-styled HTML using a template runtime: `<x-dc>`, `{{ binding }}`, `<sc-if>`,
  `<sc-for>`, `<dc-import name="Sidebar">`, and a `DCLogic` `Component` class. **This is mockup
  scaffolding, not the implementation.** Extract *visual intent* (layout, spacing, colors,
  component composition) — get behaviour from the existing React components + container.
- `Home.dc.html` is a multi-frame board (`01 — Home`, etc.) at a fixed `1920×900`. The comps are
  **fixed-size**; your React shells must be **fluid/responsive**, not pixel-frozen.
- Per `DESIGN_GUIDE.md` §0: the grey frame labels / reference board / notes are **canvas
  scaffolding, not product UI** — ignore them.

---

## 2. The toggle: `useUiVersion()`

Single source of truth for which UI renders. Create `frontend/src/features/ui/useUiVersion.ts`.

**Resolution order (synchronous, safe to call at app root):**
1. If URL has `?ui=v1` or `?ui=v2` → use it **and** persist to `localStorage["psat:uiVersion"]`.
2. Else if `localStorage["psat:uiVersion"]` is set → use it.
3. Else → **`'v2'`** (default since 2026-07-02; was `'v1'` during the parallel-life build).

```ts
export type UiVersion = "v1" | "v2";
const KEY = "psat:uiVersion";

export function resolveUiVersion(): UiVersion {
  const param = new URLSearchParams(window.location.search).get("ui");
  if (param === "v1" || param === "v2") {
    localStorage.setItem(KEY, param);
    return param;
  }
  const stored = localStorage.getItem(KEY);
  return stored === "v1" ? "v1" : "v2"; // v2 is the default
}

export function useUiVersion(): UiVersion { /* useState(resolveUiVersion) + subscribe */ }
```

Notes:
- Flip live with `?ui=v2` / `?ui=v1`; the choice sticks per browser. The default now serves
  **v2** to everyone; an explicit `?ui=v1` (or a stored `"v1"`) is the only way onto v1.
- The theme is chosen by this flag at the **root** (see §4), and Chakra's theme is fixed at
  provider mount — so **changing the flag requires a reload** to re-pick the theme. That's
  acceptable; don't try to hot-swap themes mid-session.

---

## 3. The architecture: container / shell seam

For each redesigned page, split it into two responsibilities:

| Part | Owns | Who edits it | Conflict risk |
|------|------|--------------|---------------|
| **Container** (existing page file) | data fetch, hooks, sessionStorage/cache contracts, all callbacks, building the view-model | the **team** (bugfixes) + you (one-time hoist) | shared file — touch minimally |
| **Layout shell** (new file) | pure presentation — arranges existing components, wires them to view-model props | **you only** | new file → ~zero conflict |

### Rule 1 — the prop-contract is the seam (the "don't break this" interface)

The container assembles **one typed view-model object** and passes it to whichever shell is
active. v1 and v2 shells consume the **identical** props. Define this interface explicitly
per page; it is the contract the team's logic changes and your layout changes meet at.

```ts
export interface ProjectsViewModel {
  // data
  projects: ProjectRow[];
  filteredProjects: ProjectRow[];
  selectedIds: Set<string>;
  status: string;
  // callbacks
  onSelect(id: string, checked: boolean): void;
  onCreate(): void;
  onDelete(): void;
  onOpenCoding(): void;
  onAnalyse(): void;
  onTreat(): void;
  onShare(): void;
  onEdit(id: string): void;
  // ...everything the page needs, NOTHING component-internal
}
```

The shell is a pure function of this object. If it reaches for `fetch`, `useState` for
server data, or a sessionStorage key, it's in the wrong layer.

### Rule 2 — new components get their data from the container, never their own fetch

A "few new" components are expected. If a new component needs backend data, the **container**
fetches it (through the existing hooks / `projectDataCache`) and passes it down as part of the
view-model. Purely-presentational new components live in the v2 layout folder. This keeps both
shells pure and keeps a single owner for all server state and cache invalidation.

### Rule 3 — swap = flip default, then delete (see §6)

---

## 4. Global seams (theme, shell, sidebar)

Page rearrangement lives in shells (conflict-free). The **app-global** changes can't —
they live one level up and use the *same flag* at the root. These are your only
merge-contested files; each gets **one gated conditional**, made once.

| Seam | File | v2 behaviour |
|------|------|--------------|
| Theme / dark mode | `frontend/src/components/ui/provider.tsx` (+ `color-mode.tsx`) | pick `themeV2` (forced light: `initialColorMode: "light"`, `useSystemColorMode: false`) vs `themeV1` by flag |
| App shell layout | `frontend/src/layouts/AppLayout.tsx` | full-width content / restructured shell under the flag |
| Sidebar | `frontend/src/pages/sidebar/Sidebar.tsx` | drops route-specific controls in v2 (now on-canvas); v1 untouched |

Provider currently uses Chakra's `defaultSystem` (`provider.tsx:11`). To force light in v2,
build the system from a config with the light-only color-mode settings and select it by flag.

### v2 design tokens (from `DESIGN_GUIDE.md` — these define `themeV2`)

The design guide makes the light-only theme concrete. Key values the `themeV2` config must encode:

- **Font:** Inter (400 / 500 / 700 only — no 600). Load it (`@fontsource/inter` or the Google
  Fonts link the comps use).
- **Surfaces / text:** canvas `#F7FAFC`; cards `#fff` + `1px #E2E8F0` border + `6px` radius;
  darkest text `#2D3748` (**never `#000`**). These are Chakra `gray.*` values — prefer the tokens.
- **Accent = scope, not decoration:** blue `#3182CE` = **local** (acts on one segment/selection);
  teal `#319795` = **global** (acts on the project / all). This drives primary-button color
  choice — see `DESIGN_GUIDE.md` §4.
- **RSB risk hues are unchanged:** green `#87c424` / yellow `#ffcc1a` / orange-red `#ff5b1a` /
  purple `#cd1aff` — these **already match `frontend/src/components/visualization/scoreband/colorConstants.ts`**.
  Reuse that file; do **not** redefine them in the theme.

Full normative detail (spacing, buttons, tabs, switches, chips, cards) lives in `DESIGN_GUIDE.md`
— the implementing agent should treat it as the spec and not re-derive values here.

---

## 4A. Implementation rhythm: page-by-page, milestone A then B

This is the governing cadence for the whole redesign. **Do not** do all pages at once, and
**do not** mix mechanism with design.

### One page at a time
Redesign **one page per work unit**. Projects (`/home`) is the pilot that establishes the
pattern; subsequent pages copy it. Recommended order (low → high coupling):

1. **Projects (`/home`)** — pilot; also introduces the global seams (theme, shell, sidebar).
2. **Path Analysis (`/analysis/path`)** — representative (map + panels + filters/cache).
3. **Treatment** → **Coding** → remaining pages.

Each later page is *only* a per-page container hoist + new shell — the global seams already
exist from the pilot and are **reused, not rebuilt**.

### Two milestones per page — stop for review after each

| Milestone | Scope | Done when |
|-----------|-------|-----------|
| **A — Mechanism** (no visual change) | `useUiVersion()` (first page only); hoist container state → typed view-model; extract `*LayoutV1.tsx` verbatim; wire the V1/V2 switch (V2 = stub) | page is byte-identical under `?ui=v1`; diff reviewed |
| **B — Design** | first page: build `themeV2` + global seams (§4). Every page: build `*LayoutV2.tsx` to the comp + `DESIGN_GUIDE.md` | matches the comp / screenshots under `?ui=v2`; reviewed |

- **Milestone A is the risky part** (it edits the shared container) — keep its diff small,
  behaviour-preserving, and review it *before* any design work.
- **Milestone B is conflict-free** (new shell files) apart from the one-time global-seam edits
  on the pilot.
- **Commit after each milestone**, so a page is never half-migrated in a single commit.

The Projects pilot (§5) is the worked example of exactly this A→B rhythm.

### Dark mode policy: **neutralize, don't delete** (during parallel life)

- v2 is **active and debuggable now** via the forced-light theme — so you can build and verify
  the light-only design live, with **zero** risk to v1.
- Do **not** rip out `_dark={{}}` props or dark CSS while both UIs are live. Under v2's light
  theme they simply go inert (harmless dead styling); v1 still uses them.
- **Hardcoded-color holdouts** ignore the theme flag and need direct edits to look right in v2
  (gate inside the component if a teammate is mid-flight there):
  - `frontend/src/pages/sidebar/components/CodingSidebar.tsx` — hardcoded dark hex regardless of theme
  - `frontend/src/pages/PathAnalysisPage/components/AnalysisPanel.css` — dark mode via CSS media query, not Chakra tokens
- Actual **deletion** of dark-mode code is a mechanical cleanup at **swap time** (§6), not now.

---

## 5. The Projects pilot (`/home`) — step by step

This page is the template. It's low-churn and simple — prove the mechanism here before the
hard pages (Path Analysis, Coding).

**Relevant files:**
- Container: `frontend/src/pages/Projects/projects.tsx` (default export `Home`)
- Existing styles: `frontend/src/pages/Projects/projects.css`
- Sub-components already present: `components/EditProjectModal.tsx`
- Route wiring: `frontend/src/App.tsx:56` (`<Route path="/home" element={<Home />} />`)

**Design targets for this page (from the design package, §1A):**
- Layout comp: `Home.dc.html` → frame `01 — Home` (search row, action button row, project table).
- Sidebar comp: `Sidebar.dc.html` (logo, Home / Quick Select / Coding / Path Analysis /
  Treatment nav as Ghost buttons, User Guide, profile card + Logout) — drives the global
  sidebar seam (§4).
- Spec: `DESIGN_GUIDE.md` (cards §2, buttons §4, tabs §6, table rows §7, inputs §9, sidebar §8).
- Cross-check: `screenshots/`.

**Steps:**

1. **Add the flag** — create `features/ui/useUiVersion.ts` (§2). No other page needs it yet.

2. **Hoist state in `projects.tsx`** — this is the one shared-file edit. Move *all* derived
   data and handlers into the top of `Home`, then assemble a single `ProjectsViewModel`
   object. Do **not** change behaviour. Keep this diff small and reviewable — it's the only
   part the team merges against.

3. **Extract `ProjectsLayoutV1`** — create
   `frontend/src/pages/Projects/layouts/ProjectsLayoutV1.tsx`. Move the *current* JSX body
   verbatim into it, taking `ProjectsViewModel` as props. Verify `/home` looks/behaves
   identically. (This is a pure cut-and-wire; no redesign yet.)

4. **Switch in the container** — `Home` now returns:
   ```tsx
   const ui = useUiVersion();
   const vm: ProjectsViewModel = { /* assembled above */ };
   return ui === "v2" ? <ProjectsLayoutV2 {...vm} /> : <ProjectsLayoutV1 {...vm} />;
   ```

5. **Build `ProjectsLayoutV2`** — create `layouts/ProjectsLayoutV2.tsx` matching the
   `01 — Home` comp and `DESIGN_GUIDE.md`. **Translate the comp to Chakra — don't port the
   `.dc.html` runtime.** Reuse existing components; add new presentational components in the
   same folder. Make it fluid (the comp is a fixed `1920×900` mockup). Wire everything to
   `vm`. Debug via `?ui=v2`.

6. **Global seams as needed for this page** — if the Projects v2 design assumes the new
   sidebar / full-width shell / light theme, gate those in `provider.tsx`, `AppLayout.tsx`,
   `Sidebar.tsx` per §4. Do this **once**; all pages inherit it.

**Folder convention (apply to every page):**
```
pages/Projects/
  projects.tsx                 # container (logic, builds view-model, picks shell)
  layouts/
    ProjectsLayoutV1.tsx       # current arrangement, props-driven
    ProjectsLayoutV2.tsx       # new arrangement
    <new presentational components>.tsx
```

---

## 6. Definition of done / swap procedure

The swap is the ~2-hour payoff, only because of the structure above:

1. Flip the default in `useUiVersion()` from `'v1'` to `'v2'`.
2. Delete every `*LayoutV1.tsx` shell.
3. In each container, drop the `ui === "v2" ? ... : ...` branch — render the v2 shell directly.
4. Remove the gated v1 branches in `provider.tsx`, `AppLayout.tsx`, `Sidebar.tsx`.
5. **Now** (post-swap) do the mechanical dark-mode cleanup: delete the unused `themeV1`, the
   inert `_dark={{}}` props, and the dark CSS in the holdout files.
6. Remove `useUiVersion` and the `?ui` handling once nothing references it.

---

## 7. Do / Don't quick reference

**Do**
- Keep the container as the single owner of server state, sessionStorage keys, and cache.
- Pass everything to shells via the typed view-model.
- Build v2 shells as new files; debug live with `?ui=v2`.
- Gate global seams once, at the root, behind the same flag.
- Treat `DESIGN_GUIDE.md` as the spec; reuse `colorConstants.ts` for RSB hues.

**Don't**
- Don't port the `.dc.html` runtime (`DCLogic`, `sc-if/for`, `support.js`) — translate the
  *visual intent* to Chakra/React and get behaviour from the container.
- Don't reproduce the comps' fixed `1920×900` sizing — shells must be fluid.
- Don't create `/new/*` routes or duplicate the container.
- Don't let a shell fetch data, own server state, or touch sessionStorage directly.
- Don't delete dark mode, `_dark` props, or the old sidebar while both UIs are live —
  neutralize via the v2 theme/flag; delete at swap.
- Don't try to hot-swap the theme without a reload.
- Don't change route params or sessionStorage key names (deep links / cross-page contracts
  depend on them — see CLAUDE.md).

---

## 8. Pointers

- Existing cross-page contracts that must survive: see CLAUDE.md (sessionStorage keys,
  `projectDataCache`, navigation `state` handshakes).
- After code edits, run `build_or_update_graph_tool` to keep the knowledge graph in sync
  (per CLAUDE.md).

---

## 9. Implementation log

### Projects (`/home`) — **DONE** (2026-06-28, Milestones A + B)

#### Files created

| File | Purpose |
|------|---------|
| `frontend/src/features/ui/useUiVersion.ts` | `resolveUiVersion()` (sync, safe at provider) + `useUiVersion()` hook with cross-tab storage listener. Key `"psat:uiVersion"`, default `"v1"`. |
| `frontend/src/features/ui/designTokens.ts` | All normative tokens from `DESIGN_GUIDE.md`: `FONT`, `COLOR`, `CATEGORICAL`, `RADIUS=6`, `CONTENT_PADDING=32`, `SIDEBAR_WIDTH=280`. Single import for all v2 shells. |
| `frontend/src/theme/themeV2.ts` | `createSystem(defaultConfig, defineConfig({...}))` with Inter as heading + body font. |
| `frontend/src/features/projectNav.ts` | **Single source of truth for cross-page navigation handshakes.** `openCoding(navigate, names)` — navigates with `state: { filterContext: null }` (clears stale filter context per CLAUDE.md). `openPathAnalysis(navigate, names)` — writes sessionStorage keys, calls `invalidateAll()`, clears `pathAnalysisMap_viewport`. `openTreatment(navigate, names)` — encodes names, navigates to `/treatment/...`. Used by both `SidebarV2` and `ProjectsLayoutV2`. |
| `frontend/src/pages/sidebar/SidebarV2.tsx` | v2 sidebar: logo (196px), Home, Quick Select accordion (fetches project list; individual + All checkboxes), Coding / Path Analysis / Treatment Application (disabled when nothing selected), Generated Reports (home only). Bottom section: GIS Layers (home only, above User Guide), User Guide, profile card + Logout. `children` prop for route-specific panels (CodingSidebar etc.) on not-yet-migrated pages. |
| `frontend/src/pages/sidebar/sidebar-v2.css` | `.psat-sidebar--v2`, `.psat-v2-ghost:hover`, `.psat-v2-qs-item:hover` |
| `frontend/src/pages/Projects/tagColor.ts` | `getTagColor(tag)` — HSL hash, shared by both shells. |
| `frontend/src/pages/Projects/layouts/ProjectsViewModel.ts` | Typed seam interface: all state + callbacks the container exposes; both shells consume this identical contract. |
| `frontend/src/pages/Projects/layouts/ProjectsDialogs.tsx` | Edit / Delete / Share dialogs, pure function of the view-model. Shared by both shells (no duplication). |
| `frontend/src/pages/Projects/layouts/ProjectsLayoutV1.tsx` | v1 JSX extracted verbatim from `projects.tsx`, now props-driven from `ProjectsViewModel`. |
| `frontend/src/pages/Projects/layouts/ProjectsLayoutV2.tsx` | v2 Home shell matching `Home.dc.html` frame `01 — Home`. |

#### Files modified

| File | Change |
|------|--------|
| `frontend/src/components/ui/provider.tsx` | v2 branch: `<ChakraProvider value={themeV2}>` + `<ColorModeProvider forcedTheme="light" defaultTheme="light" enableSystem={false}>`. v1 branch unchanged. |
| `frontend/src/layouts/AppLayout.tsx` | v2 gets `app-shell--v2` / `app-main--v2` CSS classes (canvas colour, zero padding — pages own their 32px). |
| `frontend/src/layouts/app-layout.css` | Added `.app-shell--v2 { background: #f7fafc }` and `.app-main--v2 { background: #f7fafc; padding: 0; min-height: 100vh }`. |
| `frontend/index.html` | Google Fonts preconnect + Inter 400/500/700 stylesheet. |
| `frontend/src/pages/sidebar/Sidebar.tsx` | v2 branch renders `<SidebarV2>` (+ CodingSidebar/TreatmentSidebar as children + confirmation dialogs). v1 branch unchanged. |
| `frontend/src/pages/Projects/projects.tsx` | Refactored as container-only: all state/handlers hoisted to top, assembled as `ProjectsViewModel`, returns `ui === "v2" ? <ProjectsLayoutV2 {...vm} /> : <ProjectsLayoutV1 {...vm} />`. URL-pinning effect auto-appends `?ui=<version>` to `/home` so the toggle is always visible in the address bar. |

#### Key design decisions

- **GIS Layers position:** bottom of sidebar, above User Guide, visible only on `/home`.
- **Project Name column:** `flex: 0 0 33%`, min-width 180px (roughly ⅓ of the usable canvas). Tags column: `flex: 1`, takes all remaining space.
- **URL pinning:** `projects.tsx` runs a `useEffect` that appends `?ui=<version>` to `/home` if the param is absent — devs always see the toggle in the address bar.
- **`projectNav.ts` rationale:** cross-page navigation has non-obvious sessionStorage and cache invalidation contracts (documented in CLAUDE.md). Centralising them in one file means the sidebar and the Projects page can both navigate without duplicating — or diverging on — those contracts.

#### Toggle

```
/home?ui=v2    → v2 shell (SidebarV2 + ProjectsLayoutV2)
/home?ui=v1    → v1 shell (unchanged)
localStorage["psat:uiVersion"] persists the choice across reloads.
```

---

### Create Project (`/projects/create`) — **DONE** (2026-06-28, Milestones A + B)

Done out of the recommended order (low-churn form page). Global seams reused from the Projects pilot — nothing app-global was touched.

#### Files created

| File | Purpose |
|------|---------|
| `frontend/src/pages/CreateProjectPage/layouts/CreateProjectViewModel.ts` | Typed seam: all form state, setters, derived data (`filteredTagSuggestions`, `canCreate`, `usingRoadSelection`, road sets) + callbacks (`onCreate`, `onCancel`, `onRoadSelectionChange`, `onImageUploadSuccess`, modal open/close). Both shells consume this identical contract. |
| `frontend/src/pages/CreateProjectPage/layouts/CreateProjectLayoutV1.tsx` | v1 JSX extracted verbatim from `createProjectPage.tsx`, now props-driven. Keeps the page's own `getTagColor`/`formatCaptureDate` (zero visual drift). |
| `frontend/src/pages/CreateProjectPage/layouts/CreateProjectLayoutV2.tsx` | v2 shell translated from **`Home.dc.html` FRAME 2 "Project Create"** (the comp lives as a frame inside the Home board, not a standalone file). Inline-styled via `designTokens`, mirroring the Projects v2 conventions. |

#### Files modified

| File | Change |
|------|--------|
| `frontend/src/pages/CreateProjectPage/createProjectPage.tsx` | Container-only: all state/effects/handlers retained, assembled into `CreateProjectViewModel`, returns `ui === "v2" ? <V2/> : <V1/>`. Added the same `?ui` URL-pinning effect as the Projects pilot. |

#### Key design decisions (Milestone B)

> **Correction:** an earlier pass mistakenly assumed no comp existed and designed a generic stacked form. The real comp is **`Home.dc.html` Frame 2** (`02 — Project Create`); the v2 shell was rebuilt to match it.

- **Structure (per Frame 2):** one full-height card; 20px/700 "Create Project" title; a two-column row (**Project Name \*** | **Project Tags**); a **"Create by:" segmented control** (`Folder` | `Map`, per §5); then the mode body; then **Create (blue 194px) / Cancel (ghost 194px)**.
- **Folder mode (default):** "Search by Folder Name" input (460px) + **Import Folder** (secondary dark inline); a **folder table** with columns Folder Name / Segments / Quarter / Distance (km) / Projects (§7 rows, ↕ sort glyphs). **Multi-select** (row checkboxes + a header select-all, per the comp) backed by a new container `selectedFolders: string[]`; `onCreate`/`canCreate` use it (array → `createProjectFromFolder`, which already accepts `string[]`), falling back to the single `folder` for v1. Local-only state in the shell: `createBy` (mode) and `folderSearch` (table filter).
- **Map mode:** `SelectRoadsMap` gained a gated `variant="v2"` branch (default `"v1"` stays byte-identical) translating Frame 2's map layout — a **340px collapsible Layer View panel** (Roads / Planning Area switches + **Import Shapefile**, replacing the old per-button toolbar), a map well with a **collapse rail (`›`)** and a **floating top-right tool cluster** (Draw Polygon + Clear), and a **separate Roads Found card** (Folder Name / Segments, always rendered — empty placeholder before a polygon exists). Both variants share one internal `renderMap()` so the Leaflet setup isn't duplicated. Switching **to Folder** clears any road selection (`onRoadSelectionChange([])` + `onSelectionGeometryChange(null)`) so the commit resolves to the chosen folder.
- **Folder table height** capped (`maxHeight:420`, scrolls) per feedback.
- **Buttons / tags** per §4/§10: Create = blue, Cancel = ghost, Import Folder = secondary dark; tag pills use the shared `Projects/tagColor.ts::getTagColor`.

#### Known gaps (intentional — flagged for follow-up)

- **Folder-table summary columns** (Segments / Quarter / Distance / Projects) have **no bulk data source** — a system-wide summary fetcher is planned for app launch. Until then they render `—` (the selected folder shows what its on-demand `fetchSourceFolderPreview` provides: Segments + Quarter).

#### Files modified (Milestone B, map mode)

| File | Change |
|------|--------|
| `frontend/src/pages/CreateProjectPage/SelectRoadsMap.tsx` | Added `variant?: "v1" \| "v2"` (default `"v1"`), a `layerPanelOpen` state, an internal `renderMap()` shared by both variants (v1 inline map de-duplicated to call it), and the full Frame-2 v2 map layout + presentational helpers (`V2LayerRow` switch, `v2ToolBtn`, `v2Checkbox`, etc.). v1 path unchanged. |

#### Toggle

```
/projects/create?ui=v2  → CreateProjectLayoutV2 (designed shell, forced-light theme)
/projects/create?ui=v1  → CreateProjectLayoutV1 (unchanged)
```

---

### Path Analysis (`/analysis/path`) — **Milestones A + B DONE** (2026-06-30)

Global seams (theme, shell, sidebar) reused from the Projects pilot — nothing app-global touched.

#### Milestone A (mechanism) — summary

`pathAnalysisPage.tsx` (was already ~177 lines, mostly a container) became container-only:
all state/effects retained, assembled into a typed `PathAnalysisViewModel`, returns
`ui === "v2" ? <PathAnalysisLayoutV2 {...vm} /> : <PathAnalysisLayoutV1 {...vm} />`. Added the
same `?ui` URL-pinning effect as the Projects/CreateProject pilots (Path Analysis does **not**
use `location.state`, so the `replaceState` is safe here — unlike Coding). `PathAnalysisLayoutV1`
is the prior page body extracted verbatim, props-driven; byte-identical under `?ui=v1`.

#### Milestone B (design) — summary

`PathAnalysisLayoutV2.tsx` translates **`PSAT Path Analysis.html` Frame 3 ("03 — Path Analysis")**
to Chakra/React + `DESIGN_GUIDE.md`, made fluid (the comp is a fixed 1920×900 mockup):

- **Row 1** — left: an **Analysis accordion card** (§14) with three sections — *Top Risk
  Contributors* (open by default), *Toggle Attributes*, *Current Filters*; right: the **Map block**
  (`PathAnalysisMapView` v2).
- **Row 2** — left: *Distribution of Project* (`AttributeDistributionChart`, reused); right:
  *Overall Risk Level* (`AggregatedScoreBandPanel` v2).

Heavy components reused with a gated `variant="v2"` (same pattern as Coding/`SelectRoadsMap`;
default `"v1"` keeps the page byte-identical under `?ui=v1`):

- **`FilterPanel` v2** = the comp's "Toggle Attributes" panel — group tabs (§6) + a 2-col grid of
  attribute rows each with a §7 switch. No internal collapsible header (the accordion owns it).
- **`AggregatedTopContributorsPanel` v2** = per-project groups of scope-coloured chips (By Project
  = grey `#718096`, §10). No internal header.
- **`AggregatedScoreBandPanel` v2** = the comp's "Overall Risk Level" card — stacked horizontal
  band bars per crash type (RSB hues from `colorConstants`) + the "Risk Level by Crash Type"
  threshold legend. (v1 still renders the pie-chart panel.)
- **`PathAnalysisMapView` v2** = the right "Map block": 6px-radius card, **pink** Jump-to-Project
  pills (§10), `AnalysisSidebar variant="v2"` (340px Layer View + collapse rail, already built for
  Coding), Leaflet `ZoomControl` removed.

#### Key decision: the **`MaybePortal`** seam (Current Filters)

The map view owns the project / category-toggle state (`categoryToggles`, `subcategoryToggles`,
`rangeFilters`, `categoryFilterAttributeIndex`, `primaryFocusAttribute`, `projectColors`, …) which
~15 memos/effects consume — lifting it is high-risk. Instead, a tiny `MaybePortal` wrapper around
the existing toggle `<Box>` renders it **inline in v1** (`to === undefined`) or **into a portal in
v2** (`to` = the "Current Filters" accordion body, captured by a callback ref in the layout). The
map view keeps owning all state; only the rendered controls move. **No state lift.**

#### Files created

| File | Purpose |
|------|---------|
| `frontend/src/pages/PathAnalysisPage/layouts/PathAnalysisViewModel.ts` | Typed seam: `loadedProjects`, `visibleProjects`, `activeFilters`, `hiddenProjects`, `visibleSegmentsByProject`, `chartData` + the 4 callbacks. Both shells consume this. |
| `frontend/src/pages/PathAnalysisPage/layouts/PathAnalysisLayoutV1.tsx` | v1 page body extracted verbatim, props-driven. |
| `frontend/src/pages/PathAnalysisPage/layouts/PathAnalysisLayoutV2.tsx` | The v2 shell (Frame 3). Holds the accordion open-state, the `filtersHost` callback-ref portal target, and the two-row layout. |
| `frontend/src/pages/PathAnalysisPage/components/paV2Primitives.tsx` | Shared v2 presentational primitives: `V2Switch` (§7), `v2TabStyle` (§6), `v2CardStyle` (§2), `AccordionSection` (§14). |

#### Files modified

| File | Change |
|------|--------|
| `frontend/src/pages/PathAnalysisPage/pathAnalysisPage.tsx` | Container-only + `useUiVersion` switch + `?ui` URL-pinning. |
| `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx` | `variant`/`filtersPortalTarget` props; `MaybePortal` helper; v2 outer-card chrome; pink Jump pills; `AnalysisSidebar variant`; `ZoomControl` gated off in v2. (Also dropped an unused `TopContributor` import in the TRC panel.) |
| `frontend/src/pages/PathAnalysisPage/components/FilterPanel.tsx` | `variant="v2"` branch (Toggle Attributes panel). |
| `frontend/src/pages/PathAnalysisPage/components/AggregatedTopContributorsPanel.tsx` | `variant="v2"` branch (chip groups). |
| `frontend/src/pages/PathAnalysisPage/components/AggregatedScoreBandPanel.tsx` | `variant="v2"` branch (Overall Risk Level stacked bars). |

#### Consistency pass (2026-06-30, follow-up)

Brought the page's "small sections" in line with the other v2 pages (Coding / Create Project /
Projects). New shared primitive: **`V2Segmented`** (§5 segmented control) in `paV2Primitives.tsx`.

- **Maps:** `MapInvalidateSize` upgraded to also do the **200ms settle + `ResizeObserver`** (mirrors
  Coding/Create-Project's `MapAutosize` — fixes the half-grey-tiles bug in the v2 card). Map/Table
  switched from Chakra `Tabs.List` to the **`V2Segmented`** control; Leaflet zoom already removed;
  `AnalysisSidebar variant="v2"` (340px Layer View + rail). Jump-to-Project pills are **pink** (§10)
  on **both** the Map and Table tabs.
- **Download:** the three colour-coded buttons collapse into a **single dark "Download ▾" dropdown**
  (§4 dropdown button) in v2.
- **Distribution of Project:** the Pie/Bar `ChartTypeToggle` is replaced by **`V2Segmented`** in v2
  (`AttributeDistributionChart variant="v2"`); the card heading is the component's specific
  "Distribution of {attr}" at 16/700 (the redundant generic title was dropped).
- **Risk Score Bands:** "Overall Risk Level" already uses the RSB hues from `colorConstants` +
  §12 9×9 legend swatches — consistent; left as-is.

#### Review round 2 (2026-06-30, user feedback)

- **Row 1 height / balance:** Row 1 now has a **fixed, viewport-fitting height**
  (`clamp(520px, calc(100vh - 152px), 900px)`) and a true **50-50 split** (`flex: 1 1 0` on both
  columns, no wrap). Both cards fill that height; the accordion card scrolls internally so opening
  accordions never grows the card or unbalances the grid, and the bottom padding is no longer clipped.
  The map view v2 now **fills its column** (outer Box + Tabs.Root + Tabs.Content `flex` column; map
  area `flex:1` instead of the v1 fixed `650px`).
- **Table → v2** (`PathAnalysisMapView`): v2 column order is **Project Name · Segment No. · Overall
  Risk Score · Coordinates · …toggle attributes… · Image Reference (last)**. **Project Name + Segment
  No. are sticky** while side-scrolling (`v2StickyStyle`, fixed 200/130px, `border-collapse:separate`
  so sticky renders). Rows restyled to §7 (16/700 headers, `1px #EDF2F7` dividers, white header).
  Table tab fills the card height and scrolls internally.
- **Toggle Attributes tabs** now use Coding's renamed labels via `V2_GROUP_TAB_LABELS`
  (Configuration · Clear Width · Surface Conditions · Intersection · Flow & Speed).
- **Current Filters inner tabs** now use the v2 tab style (`v2TabStyle`, §6) instead of Chakra line
  tabs — matching the other pages. (The toggle *pills* inside each tab are still the colour-keyed v1
  controls — see gaps.)
- **Overall Risk Level hover = Pie/Bar hover** (documented preference — see
  `feedback_distribution_hover_parity.md`): the stacked-bar segments now show a tooltip with the row,
  band, **count and %**, matching the recharts Pie/Bar tooltip. **Apply this to every distribution
  readout going forward.**

#### Review round 3 (2026-06-30, user feedback)

- **True 50-50, both rows:** all four cards now use identical `flex: 1 1 0; min-width: 0` (no wrap),
  so Row 1 and Row 2 align column-for-column (the accordion no longer looks wider than the Pie/Bar
  card).
- **Single-row tabs:** Toggle Attributes **and** Current Filters tab strips now stay on **one row and
  scroll horizontally** instead of wrapping to a second row (new `v2TabRowStyle` primitive: `nowrap` +
  `overflow-x:auto` + non-shrinking tab chips, scrollbar hidden).
- **Standard distribution tooltip:** the user preferred the *simple* hover over recharts' heavy
  outlined card. New shared **`DistTooltipBox`** primitive (white, `1px #E2E8F0`, radius 4, **no
  shadow**, 12px: bold title + `Count: N (P%)`) is now used by the v2 **Pie and Bar** charts *and* the
  "Overall Risk Level" stacked bars. **This is the documented standard for every distribution
  readout** (also saved to `feedback_distribution_hover_parity.md`).

#### Review round 4 (2026-06-30, user feedback — final)

- **Width (definitive fix):** both rows are now **CSS Grid `grid-template-columns: 1fr 1fr; gap: 32px`**
  instead of flexbox. 1fr tracks are mathematically equal regardless of content (items carry
  `min-width: 0` + `overflow: hidden`), so the accordion and the Pie/Bar card are provably the same
  width. (Flexbox `1 1 0` *should* have been equal too, but grid removes any sub-pixel/intrinsic-size
  ambiguity.)
- **Map tools relocated:** the polygon + single-select tool menus (and the polygon "Delete/Copy
  Selected" confirm buttons) move **off the top bar into a floating cluster over the map** in v2
  (white box, `1px #E2E8F0`, radius 6, `boxShadow sm`, top-right) — the same treatment as Coding's
  floating map controls. Implemented by wrapping the existing tools in `MaybePortal` (inline in v1,
  portalled to an absolute host `Box` on the map in v2) — no logic duplicated.
- **Tab-content padding:** the Chakra `Tabs.Content` default padding (the stray ~16px top gap above
  the map/table content) is removed in v2 (`p: 0` on both map & table content panels).
- **Table column widths:** header titles are `white-space: nowrap` (no wrapped title rows); columns
  flex to the title and the 4 base columns fill the width, extra (toggle) columns overflow-scroll.
  Body cells may still wrap (intended).
- **Table sort glyphs:** every column shows the Home/Create sort glyph — `↕` (`12px #A0AEC0`) when
  unsorted, `▲`/`▼` (`12px #4A5568`) + priority number when sorted.

#### Known gaps / deviations (intentional)

- **Metric overlay** (Curv./Width/Grade floating cluster, §13) is **omitted** — it needs per-hover
  segment metrics not currently tracked; rendering fake values would be misleading.
- **Current Filters toggle pills** (inside each tab) keep their v1 colour-keyed pill styling. They're
  shared verbatim with v1 and wired to the map view's internal setters, so a full §7-row restyle is
  higher-risk; the tab chrome is now v2. The block also shows only while the Map tab is active (the UI
  lives inside `Tabs.Content value="map"`); filters still apply in Table view, the controls are hidden.
- **Typecheck:** root `tsc --noEmit` is **clean (exit 0)** and `vite build` bundles. The strict
  `tsc -b` (the `npm run build` prebuild) has **pre-existing** errors in untouched files
  (`GeoDataPanel.tsx`, `PostTreatmentImageUpload.tsx`, `treatmentDetailPage.tsx`) — not introduced here.

#### Toggle

```
/analysis/path?ui=v2  → PathAnalysisLayoutV2 (Frame 3 design, forced-light theme)
/analysis/path?ui=v1  → PathAnalysisLayoutV1 (current interface, byte-identical)
```

### Coding (`/coding/:projectNames`) — **Milestones A + B DONE** (2026-06-29)

Done out of the recommended order at the user's request. Global seams (theme, shell, sidebar)
reused from the Projects pilot — nothing app-global was touched.

#### Milestone B (design) — summary

`CodingLayoutV2.tsx` translates `Home.dc.html` **FRAME 4 ("04 — Coding")** to Chakra/React +
`DESIGN_GUIDE.md` tokens, made fluid (the comp is a fixed 1920×900 mockup). Per the redesign's
core idea, route-specific controls move **on-canvas**: the Segment-Navigator steppers, **Auto-code
by Segment** (blue/local §4), **Auto-code by Attributes** (teal/global §4), Previous/Next, and a
fixed bottom-right **Save dock** all live on the page now.

- **Reused heavy components** (not rebuilt): `ImagePanel` (street-view + brightness),
  `AttributesPanel` (attribute tabs/grid + editing), `GeoDataPanel` (Map Preview & Analysis),
  `AutocodeValidation` (Automation Retention Rate). The lighter readout chrome is reproduced from
  the comp with `designTokens`: project tabs (joining the card, §6), segment-navigator steppers
  (§15), Crash Type Scores row + RSB legend (§11/§12), TRC chips (pink = By Segment, grey = By
  Project, §10), the attribute-select checklist, and the Save dock.
- **On-canvas controls dispatch the existing global `window` events** the container already
  listens for — `psat:autocode:one`, `psat:autocode:by-field` (`{fields}`), `psat:save`. No new
  container plumbing.
- **Auto-code by Attributes** opens an inline grouped **checklist** (from
  `constants/autocodeAttributes.ts` `GROUP_ORDER`/`GROUP_RULES`, mapped to backend keys via
  `KEY_ALIASES`) with Select None/All + Cancel/confirm — replacing the attribute editor while
  selecting. **Deviation from the comp:** the comp shows a checkbox on each editable attribute row;
  reproducing that would require modifying the shared `AttributesPanel`, so a dedicated checklist is
  used instead (same outcome, simpler, v1-safe).
- **RSB band colours** use `colorConstants.RISK_BAND_COLORS` + a local per-crash-type threshold
  helper mirroring `SegmentScoresCard` (BB/BP/SB <5/≤10/≤20, VB <10/≤25/≤60); the Risk-Score card
  uses `getSegmentRiskBandColor`. The comp splits Crash Type Scores (left) from TRC (right), so
  `SegmentScoresCard` (which bundles both) is **not** reused for this row.

#### Files created (Milestone B)

| File | Purpose |
|------|---------|
| `frontend/src/pages/CodingPage/layouts/CodingAttributeModals.tsx` | Shared attribute-editing modal stack (`AttributeOptionsDialog` + 6 `PresentMultiTagModal` prompts + `getParentCategoryForSubcat`/`PresentMultiTagModal`), extracted from `CodingLayoutV1` so **both** shells render `<CodingAttributeModals {...vm} />`. Pure function of the view-model. |
| `frontend/src/pages/CodingPage/layouts/CodingLayoutV2.tsx` | The v2 Coding shell (replaces the Milestone-A stub). |

`CodingLayoutV1.tsx` was trimmed to import the shared modals (render output unchanged — still
byte-identical under `?ui=v1`).

#### Milestone A (mechanism) — summary

**Mechanism only — no visual change.** The page is byte-identical under `?ui=v1`.

This is the highest-churn container in the app (~3000 lines: 4 autocode event handlers,
~20 effects, the per-project data cache, logic-check engine, forced multi-tag modals). The
hoist kept **all** of that logic in the container untouched; only the render tree moved.

#### Files created

| File | Purpose |
|------|---------|
| `frontend/src/pages/CodingPage/codingConstants.ts` | Shared types (`ProjectDetail`, `AttrMappings`, `ProjectDataState`) + the 3 constants used by **both** the container and a layout (`FO_TYPE_SUGGESTIONS`, `NFO_TYPE_SUGGESTIONS`, `FACILITY_WIDTH_SUBCATEGORY_MAP`). Extracted to a third module to avoid a container↔layout circular import. |
| `frontend/src/pages/CodingPage/layouts/CodingViewModel.ts` | Typed seam: ~75 fields (tabs, load/error gating, autocode overlay, current-segment data, pagination, scores card, path-analysis review flow, attribute editing, analysis overlays, options dialog, forced multi-tag modals). Both shells consume this identical contract. |
| `frontend/src/pages/CodingPage/layouts/CodingLayoutV1.tsx` | v1 render extracted **verbatim** — all 5 return branches (no-projects, loading/preloading, error, Coding Guide, main). Also holds the render-only `PANEL_HEIGHT`, `getParentCategoryForSubcat`, and the `PresentMultiTagModal` component moved out of the container. |
| `frontend/src/pages/CodingPage/layouts/CodingLayoutV2.tsx` | Milestone-A **stub** — placeholder under `?ui=v2`. |

#### Files modified

| File | Change |
|------|--------|
| `frontend/src/pages/CodingPage/codingPage.tsx` | Container-only: removed all render JSX + the moved consts/types/helpers/`PresentMultiTagModal`; dropped now-unused Chakra/component imports; lifted the 3 inline JSX handlers (`onBackToAnalysis`, `onDiscardAndExit`, `onSaveAndExit`) into named container functions; assembled the `CodingViewModel`; returns `ui === "v2" ? <CodingLayoutV2 {...vm} /> : <CodingLayoutV1 {...vm} />`. |

#### Key decisions / gotchas

- **No `?ui` URL-pinning effect here** (unlike the Projects/CreateProject pilots). CodingPage
  relies heavily on `location.state` (`filterContext`, `returnToAnalysis`), and the pilots'
  pinning calls `window.history.replaceState(null, …)` — passing `null` state would **wipe
  React Router's `location.state`** and break filter-context restore + the "Back to Path
  Analysis" button. The toggle still works via explicit `?ui=v2` + the persisted
  `localStorage["psat:uiVersion"]`.
- **Three-module split** (container + `codingConstants` + layout) avoids a circular import:
  the layout can't import the consts from the container while the container imports the layout.
- **Lifted handlers** read the module-level `savedAttrsSnapshot` (container-owned), so the
  shell never reaches into container module state — it only calls `vm` callbacks.
- **Typecheck:** the refactor introduces **zero** new `tsc` errors. The 3 pre-existing
  `{ [x: string]: unknown }[]` errors in `codingPage.tsx` (present at HEAD, lines 968/1305/1312)
  are unchanged and unrelated.

#### Milestone B — review fixes (2026-06-29)

Feedback pass after the first B build. The reused-as-is heavy components looked v1; fixed by
giving each a gated `variant="v2"` branch (the same pattern `SelectRoadsMap` uses — default
`"v1"` keeps `treatmentDetailPage` byte-identical):

| Issue | Fix | File |
|-------|-----|------|
| v2 coding showed the v1 `CodingSidebar` in the sidebar | Dropped the embedded `CodingSidebar` from the v2 `SidebarV2` children — Coding is migrated, its controls are on-canvas now (Treatment still passes through). | `frontend/src/pages/sidebar/Sidebar.tsx` |
| Street-view image rendered tiny | ImagePanel's `h="100%"` needs a definite parent height; gave the wrapper a fixed `440px`. | `CodingLayoutV2.tsx` |
| Attributes panel was v1 design | `AttributesPanel` gained `variant="v2"`: comp tabs (§6) + 2-col grid of inline value fields (§9), reusing the same grouping/edit logic. | `components/AttributesPanel.tsx` |
| Map preview was v1 design + had Leaflet zoom buttons | `GeoDataPanel` gained `variant="v2"`: tools become a **floating top-right cluster** over the map, the Leaflet `ZoomControl` is removed, card chrome → 6px radius. | `components/GeoDataPanel.tsx` |
| Auto-code Validation was v1 design | `AutocodeValidation` gained `variant="v2"`: "Automation Retention Rate" card — header + legend + tabs (§6) + validation chip grid (§10). | `PathAnalysisPage/components/AutocodeValidation.tsx` |

`CodingLayoutV2` passes `variant="v2"` to all three.

**Layer-View panel (follow-up, done):** `AnalysisSidebar` gained `variant="v2"` — a **static
340px** Layer View panel (DESIGN_GUIDE §13: `1px #EDF2F7` divider, §7 on/off switches, dark
"Import Shapefile" button) instead of the v1 220px slide-in overlay. The import-shapefile props were
made **optional** (PathAnalysisMapView wires them; Coding's GeoDataPanel doesn't) — which also
cleared a pre-existing `tsc` error (GeoDataPanel 25→24 errors).
File: `frontend/src/components/visualization/AnalysisSidebar.tsx`.

#### Milestone B — review fixes, round 2 (2026-06-29)

| Issue | Fix |
|-------|-----|
| Image had horizontal letterbox bars / too short | Left column (Crash Type Scores + image + autocode/nav) now **stretches to match the right (attributes) column height** — the image wrapper is `flex:1` (min 300px), so it fills the space the column gains. `ImagePanel` got a `fit?: "contain" \| "cover"` prop (default `"contain"`, v1 unchanged); v2 passes `"cover"` so the photo **fills** the box with no bars. |
| Crash Type Scores used placeholder circles | v2 RSB cards now render the real `CycleRAP Assets/{BB,BP,SB,VB}.png` icons (same assets `SegmentScoresCard` uses). |
| **Map didn't render** | The round-1 v2 made `GeoDataPanel`'s `CardBody` a flex row, which broke Leaflet's initial size measurement (blank map). Reverted to the **v1 full-area map** (relative `CardBody`, map `h=100%`); the Layer View panel is now **`position:absolute` on the left** over the map instead of a flex sibling — Leaflet sizes correctly. |
| GIS Layer panel still looked like a v1 pop-out | With the absolute static panel above, the v2 Layer View is **always visible, 340px, no toggle chevron** — not the v1 slide-in. |
| Sparkle ✨ on autocoded attributes | Removed from the v2 attribute label. |
| **Autocode highlight too subtle** (yellow border only) | Restored the **old whole-cell highlight**: the entire rounded attribute cell is tinted — **red** `#FFF5F5`/`#E53E3E` = manual edit, **yellow** `#FFFFF0`/`#D69E2E` = autocoded change, **green** `#F0FFF4`/`#38A169` when `highlightColor="green"` (Treatment). A 2px transparent border keeps layout stable when inert. *(This is the documented highlight scheme for v2 attributes.)* |
| `(i)` tooltip icon per attribute | Removed; the **attribute title text itself** is now the hover-tooltip trigger (`cursor:help`). |
| Attribute panel jumped as TRC grew 3→3.5 rows | The TRC chip area is a **fixed `90px` (~3-row) height with internal scroll**, so the attribute panel below it no longer shifts segment-to-segment. |

Files: `CodingLayoutV2.tsx`, `components/ImagePanel.tsx`, `components/AttributesPanel.tsx`,
`components/GeoDataPanel.tsx`, `components/visualization/AnalysisSidebar.tsx`.

#### Milestone B — review fixes, round 3 (2026-06-29)

| Issue | Fix |
|-------|-----|
| TRC chip area too short (cut row 3) | Bumped the fixed chip-area height `90px → 112px` so a full 3 rows show before scrolling. |
| **Map painted half-grey** (also on Create Project) | Leaflet caches container size at init; in the v2 layout the map's final height settles after init. Added a `MapAutosize` helper (inside the `MapContainer`) that calls `map.invalidateSize()` after a 200ms settle **and** via a `ResizeObserver` on the container. Added to **both** `GeoDataPanel` and `SelectRoadsMap` (Create Project). |
| Save button in the corner dock | Removed the fixed bottom-right Save dock; **Save now sits at the far right of the segment-navigator row**, just right of the `/N` page counter. |
| Coding Guide tab scrolled away with many projects | The project tabs now live in a **horizontally-scrolling** left group; **Coding Guide + CycleRAP are a sticky right cluster** (never scroll), so the guide is reachable from any project. Safety measure for large project sets. |
| Attribute tab row had a vertical "wiggle" scroll | The tab text line-height exceeded the tab box; set tab `lineHeight:1` + `box-sizing:border-box` and the tab row `overflow-y:hidden`. |
| **Attribute tab labels shortened** (documented) | v2 attribute **and** validation tabs drop the "Facility" prefix: **Configuration · Clear Width · Surface Conditions · Intersection · Flow & Speed**. The underlying group keys are unchanged; only the displayed label is mapped via `V2_GROUP_TAB_LABELS` (new export in `frontend/src/constants/autocodeAttributes.ts`), shared by `AttributesPanel` (v2) and `AutocodeValidation` (v2). |

Files: `CodingLayoutV2.tsx`, `components/AttributesPanel.tsx`, `components/GeoDataPanel.tsx`,
`PathAnalysisPage/components/AutocodeValidation.tsx`, `CreateProjectPage/SelectRoadsMap.tsx`,
`constants/autocodeAttributes.ts`.

#### Milestone B — review fixes, round 4 (2026-06-29)

| Issue | Fix |
|-------|-----|
| Layer View missing the Import button & not collapsible | The v2 `AnalysisSidebar` now (a) renders the **Import Shapefile** section unconditionally (matching v1's contents), and (b) is **collapsible** via an edge rail (`›` / `‹`) driven by the same `isOpen`/`onToggle` GeoDataPanel already passes. v2 defaults to **open** (`isAnalysisSidebarOpen = variant === "v2"`); v1 unchanged (collapsed). Switch on-track color left black (`#2D3748`) per request — to be revisited. |
| Autocoded attribute title lacked source tag | The attribute title is appended with **`(CV)`** or **`(GIS)`** when the field was autocoded (from `fieldSources[k]`) — restoring the v1 standard-feature behaviour (without the sparkle). |
| Highlighted attribute's inner dropdown/input stayed white | The value box is now **tinted to match the cell** (yellow/red/green `bg` + matching border) instead of staying white; inert fields stay white with a neutral border. |

Files: `components/AttributesPanel.tsx`, `components/GeoDataPanel.tsx`,
`components/visualization/AnalysisSidebar.tsx`.

#### Milestone B — review fixes, round 5 (2026-06-29)

| Issue | Fix |
|-------|-----|
| Layer View should start **closed** (Coding + Create Project) | `GeoDataPanel`'s `isAnalysisSidebarOpen` and `SelectRoadsMap`'s `layerPanelOpen` now default to `false`. |
| Collapse handle should be a small rounded **tab** (v1 style), not a full-height rail | Coding (`AnalysisSidebar` v2) now uses the **same Chakra `IconButton` tab as v1** (24×40, `borderRightRadius`, `FiChevronsLeft/Right`, vertically centered). Create Project (`SelectRoadsMap` v2) uses a matching inline-styled tab button with the same chevrons. |

Files: `components/GeoDataPanel.tsx`, `components/visualization/AnalysisSidebar.tsx`,
`CreateProjectPage/SelectRoadsMap.tsx`.

#### Toggle

```
/coding/<names>?ui=v2  → CodingLayoutV2 (FRAME 4 design, forced-light theme)
/coding/<names>?ui=v1  → CodingLayoutV1 (current interface, byte-identical)
```

### Treatment Application (`/treatment/:projectName`) — **Milestones A + B DONE** (2026-06-30)

Global seams (theme, shell, sidebar) reused from the Projects pilot — nothing app-global was
rebuilt. The page to redesign is **`treatmentDetailPage.tsx`** (the multi-project detail view at
`/treatment/<names>`); `treatmentPage.tsx` (the v1 project-picker list) is superseded in v2 by the
sidebar Quick Select + Treatment Application nav and was left untouched.

#### Milestone A (mechanism) — summary

`treatmentDetailPage.tsx` (~2160 lines, one giant component) became container-only: all
state/effects/handlers retained, the pure constants/helpers extracted to a third module, the render
tree moved into `TreatmentDetailLayoutV1` (verbatim, props-driven), assembled into a typed
`TreatmentViewModel`, returns `ui === "v2" ? <V2/> : <V1/>`. No `?ui` URL-pinning (Treatment, like
Coding, can carry `?segment=` / navigation `state`; the pilots' `replaceState(null,…)` would be
unsafe — the toggle still works via explicit `?ui=v2` + persisted `localStorage`).

The page-level bulk actions (**Treat All / Reset All / Save / Generate Report / Exit**) that lived in
the **v1 sidebar** `TreatmentSidebar` were re-implemented in the **container** (it already listens for
`psat:treat:all:completed` / `psat:reset:all:completed`) so they can move on-canvas in v2. v1 is
unchanged — the v1 sidebar still renders `TreatmentSidebar`.

#### Milestone B (design) — summary

`TreatmentDetailLayoutV2.tsx` translates **`temp/psat-design/Treatment Application.dc.html`** (+ the
`ta-final` screenshot, the most-evolved reference) to Chakra/React + `DESIGN_GUIDE.md`, made fluid:

- **Title row** — title (20/700) + subtitle, and the on-canvas **page-action cluster** (Treat All
  Segments [teal/global §4], Reset All [danger], Save [blue], Generate Report [dark], Exit [ghost]),
  matching `ta-final` (the comp itself put Save/Report/Reset in the context strip; the screenshot
  graduated them to the title row + added Treat All / Exit, so the screenshot was followed).
- **Project tabs** (`v2TabStyle`, single-row scroll) joining the **single merged card**
  (`0 6px 6px 6px`).
- **Context strip** — Segment **stepper** (§15) + Jump-to input + **Effectiveness** readout (% of
  in-scope segments whose Overall band improved, computed in the container).
- **Maps row** — two `GeoDataPanel variant="v2"` (Before / After Treatment).
- **Body grid** — col 1: Segment Photo (`ImagePanel fit="cover"`) + Previous/Next + Post-Treatment
  upload; col 2: **Treatment Options** (`V2Segmented` By Segment/By Treatment + comp-styled rows with
  green/blue/off checkboxes + All/Clear/Reset/Copy/Apply), **Crash Type Scores** (inline RSB cards
  with real CycleRAP icons + ↓ deltas + status pill + **pink TRC chips** §10), **Attributes**
  (`AttributesPanel variant="v2"` + §7 Show-Pre-Treatment switch, `highlightColor="green"`).
- **Bottom** — Before/After **Overall Risk Level** cards: per-crash-type stacked band bars (RSB hues)
  + the "Risk Level by Crash Type" threshold legend, built inline from `before/afterBandCounts`.

Heavy components reused with their existing `variant="v2"` (GeoDataPanel, AttributesPanel) or as-is
(ImagePanel, PostTreatmentImageUpload). The apply-to-all confirm reuses the Chakra dialog; reset-all
reuses `ResetConfirmationDialog`.

#### Files created

| File | Purpose |
|------|---------|
| `frontend/src/pages/TreatmentPage/treatmentConstants.ts` | Pure constants/types/helpers (TREATMENTS, copy-prompt logic, clipboard helpers, band/distribution helpers, `ALL_PROJECTS`) — shared by container + both shells (avoids container↔layout circular import, same pattern as `codingConstants.ts`). |
| `frontend/src/pages/TreatmentPage/layouts/TreatmentViewModel.ts` | Typed seam consumed by both shells. |
| `frontend/src/pages/TreatmentPage/layouts/TreatmentDetailLayoutV1.tsx` | v1 render extracted verbatim, props-driven (byte-identical under `?ui=v1`). |
| `frontend/src/pages/TreatmentPage/layouts/TreatmentDetailLayoutV2.tsx` | The v2 shell. |

#### Files modified

| File | Change |
|------|--------|
| `frontend/src/pages/TreatmentPage/treatmentDetailPage.tsx` | Container-only: logic retained, constants/helpers/render removed; added `onTreatAll/onConfirmResetAll/onSaveAll/onGenerateReport/onExit` + `effectivenessLabel`; assembles `TreatmentViewModel`; `useUiVersion` switch. |
| `frontend/src/pages/sidebar/Sidebar.tsx` | v2 branch no longer embeds `TreatmentSidebar` (treatment controls are on-canvas now); v1 branch unchanged. |

#### Known gaps / deviations (intentional)

- **Exit** in v2 navigates straight to `/home` (the on-canvas Save is explicit; per-segment
  treatments auto-persist to the backend on Apply). v1 keeps its own exit-confirm dialog.
- **Typecheck:** root `tsc --noEmit` is **clean (exit 0)**. The strict `tsc -b` shows only the
  **pre-existing** `PostTreatmentImageUpload.tsx` errors (untouched) — none introduced here.

#### Follow-ups since resolved

- **Stacked-bar hover — DONE.** The Before/After "Overall Risk Level" bars now use the shared
  `DistTooltipBox` (label + `Count: N (P%)`), matching every other v2 distribution readout
  (`TreatmentDetailLayoutV2.tsx`, via a `barHover` state + `RiskLevelCard`). The old native-`title`
  note is obsolete.
- **Unsaved-changes guard — DONE (2026-07-03).** See the dedicated entry below.

### Treatment — unsaved-changes guard (2026-07-03)

**What "unsaved" honestly means here.** Segment-view (`By Segment`) treatment toggles auto-persist:
each toggle debounces into `applyTreatments`, whose backend handler calls `proj.save_all()` (writes
`treatment.csv` to disk), and a still-pending debounce is flushed on unmount. So segment edits are
**never** lost by navigating away. The **only** genuinely-unpersisted state is a staged bulk
**`By Treatment`** selection (`isStagingPreview = accordionView !== "segment" && selectedTreatments.size > 0`)
— a live preview the user hasn't applied yet.

**Wiring (all in the container, `treatmentDetailPage.tsx`):**
- An effect syncs `window.psat_hasUnsavedChanges = isStagingPreview` and clears it to `false` on
  unmount (so a stale flag never prompts on another page). This is the flag `Sidebar.guardedAction`
  reads (route-gated to `/treatment/*`).
- An effect listens for the shared exit dialog's events: `psat:save` → `handleConfirmApplyToAll()`
  (commits the staged selection exactly as the on-canvas Apply button would); `psat:discard` →
  clears `selectedTreatments` + the live preview.

**Why the flag is *not* set for segment edits:** doing so would prompt "unsaved changes" on a page
that has already saved everything — a false alarm. Rule 10 (§0): set the flag only for genuinely
unpersisted work. No new sidebar plumbing was needed — the generic `guardedAction` /
`ExitConfirmationDialog` mechanism (built for Coding) simply participates now that Treatment sets the
flag and honours the two events.

**Key files:**
- `frontend/src/pages/TreatmentPage/treatmentDetailPage.tsx` — the two effects (flag sync + event
  listeners), placed just after `isStagingPreview`.
- `frontend/src/pages/sidebar/Sidebar.tsx` — `guardedAction` (route-gated), `handleSaveAndExit`
  (dispatches `psat:save`), `handleDiscardAndExit` (dispatches `psat:discard`) — unchanged.

#### Toggle

```
/treatment/<names>?ui=v2  → TreatmentDetailLayoutV2 (comp design, forced-light theme)
/treatment/<names>?ui=v1  → TreatmentDetailLayoutV1 (current interface, byte-identical)
```

### v1 feature parity — restored into v2 (2026-06-30)

Three features that existed in v1 but were missing from the v2 shells:

1. **Home — Clear filters.** v1 showed a "Clear filters" button on its own summary row.
   v2 instead adds a single **big `×`** at the end of the "Search by Tags" bar that calls the
   existing `clearAllFilters()` (clears name query + all tag filters); shown only when
   `hasActiveFilters`. Both vm fields already existed on `ProjectsViewModel`; only
   `ProjectsLayoutV2.tsx` was touched (destructure + button).
2. **Path Analysis — Generate Report.** Ported the v1 sidebar's report button into v2 **beside
   the Download dropdown** in the map view's toggle row (teal = global scope, §4). Label flips
   `📄 Generate Report` ↔ `📄 Continue Report` via a `hasSavedReport` memo
   (`localStorage["psat_report_layout"]`); on click `sessionStorage.removeItem("treatment_loadedProjects")`
   + `navigate("/analysis/report")` — identical to the v1 sidebar handler.
   File: `PathAnalysisPage/components/PathAnalysisMapView.tsx`.
3. **Global — exit-without-saving on sidebar nav.** In v1 the exit dialog fired from per-page
   Exit buttons. In v2 those moved on-canvas, so the dialog is now triggered by the **sidebar**:
   `SidebarV2` routes **every** nav button (Home, Quick-Select Coding/Path Analysis/Treatment,
   Generated Reports, GIS Layers, User Guide) through a new `onGuardedAction(action)` prop. The
   parent (`Sidebar.tsx::guardedAction`) shows `ExitConfirmationDialog` when the current page has
   unsaved changes (`window.psat_hasUnsavedChanges`), **route-gated to coding/treatment** so a
   stale dirty flag never prompts on unrelated pages. The pending navigation is stored as a
   **callback** (`window.psat_pendingAction`) — not just a path — because the Quick-Select
   handshakes (`openCoding/openPathAnalysis/openTreatment`) do sessionStorage setup beyond a plain
   `navigate`; `completeExitAction` runs it on Save/Discard. Coding sets `psat_hasUnsavedChanges`
   from an attrs-vs-snapshot diff; **Treatment now participates too** (2026-07-03) — it sets the
   flag from its staged bulk selection and honours `psat:save`/`psat:discard` (see the "Treatment —
   unsaved-changes guard" entry above). Files: `sidebar/Sidebar.tsx`, `sidebar/SidebarV2.tsx`,
   `pages/TreatmentPage/treatmentDetailPage.tsx`.

### User Guide (`/help`) — **Milestones A + B DONE** (2026-06-30)

Global seams (theme, shell, sidebar) reused from the Projects pilot — nothing app-global touched.

**Sidebar = legitimate (affects v1 too).** `/help` was moved **into a real `AppLayout` parent route**
in `App.tsx` — but deliberately kept **outside `RequireProfile`** so it stays publicly accessible
(e.g. clicking the floating `?` from the landing page works pre-login). This means the sidebar now
comes from the actual layout (`AppLayout` → `<Sidebar />`, which picks SidebarV2/v1 via
`useUiVersion`) for **both** UI versions — v1 help gains the v1 sidebar, v2 help gains SidebarV2.
The earlier "v2 shell renders its own `<Sidebar/>`" hack was removed; `HelpPageLayoutV2` now returns
just the canvas (AppLayout provides shell + sidebar + `<main>`). This is the long-term-correct seam:
help is a normal page in the app frame, just un-gated.

#### Milestone A (mechanism) — summary

`helpPage.tsx` became container-only: `activeTab` state + `onBack` + `useUiVersion` switch.
`HelpPageLayoutV1` is the prior page body extracted verbatim, props-driven; byte-identical under
`?ui=v1`.

#### Milestone B (design) — summary

`HelpPageLayoutV2` is a unified shell translating **`User Guide.dc.html`** to React +
`designTokens` + the shared `paV2Primitives` (`v2TabStyle`, `v2CardStyle`), made fluid:

- **Sidebar from AppLayout** (see above) — the shell returns just the canvas; `app-main--v2`
  (padding 0, 280px sidebar offset, `#F7FAFC`) hosts it. `/help` is inside `ProfileProvider`, so the
  sidebar's `useProfile` works even pre-login (`activeProfile` may be null → no profile card; Quick
  Select fetch fails silently → empty).
- **Canvas:** `height:100vh`, 32px padding, `COLOR.canvas` (`#F7FAFC`), Inter.
- **Page title** — "User Guide" at 20/700.
- **Three tab pills** (User / Admin / Developer) via `v2TabStyle` — join the card below; labels are
  the comp's short form ("User", "Admin", "Developer").
- **Content card** via `v2CardStyle({ borderRadius: "0 6px 6px 6px" })`, fills remaining height.
  - **Left nav (230px):** **no "Documents" label** (removed per feedback). One **"Last updated
    {latest}"** caption at the top — the single most-recent `updatedDate` across the active tab's docs
    (computed via `monthYearRank`/`latestUpdated`), instead of a per-section date on every item.
    Section items are now just `{num}. {title}` (16/700), active = `#3182CE` bg + white, hover =
    `#F7FAFC`.
  - **Right content:** overflow-y scroll, 28px/36px padding, markdown via a forced-light renderer
    (`V2MarkdownContent`, tokenised colors). All three tabs' doc lists are inlined; `activeIdx` resets
    on tab change; content scrolls to top on section change.

The shell consolidates all three guides (`UserGuide`, `AdminGuide`, `DeveloperGuide`) into one
unified component — the old per-guide sub-components are still used by `HelpPageLayoutV1` only.

#### Files created

| File | Purpose |
|------|---------|
| `frontend/src/pages/HelpPage/layouts/HelpPageViewModel.ts` | Typed seam: `activeTab`, `setActiveTab`, `onBack`. Both shells consume this. |
| `frontend/src/pages/HelpPage/layouts/HelpPageLayoutV1.tsx` | v1 render extracted verbatim, props-driven. |
| `frontend/src/pages/HelpPage/layouts/HelpPageLayoutV2.tsx` | The v2 unified canvas: tokenised design, one "last updated" per tab, forced-light markdown renderer, all 3 guide doc lists. Sidebar/shell come from AppLayout. |

#### Files modified

| File | Change |
|------|--------|
| `frontend/src/pages/HelpPage/helpPage.tsx` | Container-only: `activeTab` state + `onBack` + `useUiVersion` switch. |
| `frontend/src/App.tsx` | `/help` moved into a real (un-gated) `<AppLayout>` parent route so it gets the legitimate sidebar for both UI versions while staying public. |

#### Toggle

```
/help?ui=v2  → HelpPageLayoutV2 (comp design, forced-light markdown)
/help?ui=v1  → HelpPageLayoutV1 (current interface, byte-identical)
```

---

### Remaining pages — status

See the status table in **§0**. In short:

- **Report Builder** (`/analysis/report`), **GIS Layers** (`/gis-layers`), **Generated Reports**
  (`/generated-reports`) — **cosmetic `isV2` only**: each reads `useUiVersion()` and applies inline
  token tweaks (`cardRadius`/`cardShadow`/`headWeight`/`contentPad`, teal buttons) but keeps the v1
  layout. They have **no Frame redesign, no container/shell split, no `*LayoutV2.tsx`**. A full
  redesign of any of them = a fresh Milestone A + B per §3–§5 (hoist container → view-model → extract
  `*LayoutV1` → build `*LayoutV2`). Do **not** grow the inline `isV2` ternaries into a de-facto
  layout — that violates §0 rule 1.
- **Landing Page & Profile System** (`/`) — **not touched**; still pure v1 and the first screen every
  user sees now that v2 is default. Highest-visibility remaining gap.

---

## Sizing & Responsive-Unit Conversion Catalog (px → hybrid rem / vh / vw)

> Added **2026-07-02**. Purpose: the v2 UI is authored entirely in absolute pixels
> (`DESIGN_GUIDE.md`, `designTokens.ts`, and every layout's inline styles). Pixels don't
> track the viewport, so the design is pixel-perfect on one screen and degrades on other
> aspect ratios. This catalog records **every hardcoded dimension** and its correct-unit
> equivalent under the **hybrid** strategy, calibrated so the rendered result is
> **byte-identical at the reference viewport** and only *scales* elsewhere.
>
> **Status: APPLIED (2026-07-02, commit "refactor(v2): convert v2 UI from px to hybrid
> responsive units").** The v2 layouts and shared tokens/primitives now use these units
> (`rem` for type/spacing/component sizes; `clamp()`/`vh`/`vw` for layout heights), calibrated
> to render byte-identical at the 1920×911 reference viewport. Keep this table as the canonical
> conversion reference: any **new** v2 UI must be authored in these units from the start (§0
> rule 5), and any page redesigned later must follow it.

### Reference & conversion bases

- **Reference viewport:** `1920 × 911` CSS px (browser maximized, 1080p monitor, 100% zoom).
- **Root font-size:** assumed default `16px` (confirm `html`/`body` never override it — every
  `rem` below depends on this).

| Unit | 1 unit equals | px → unit formula | Screen-dependent? |
|------|---------------|-------------------|-------------------|
| `rem` | `16px` (root font) | `px ÷ 16` | **No** — identical on every screen; also respects browser zoom / accessibility font scaling |
| `vw`  | `19.2px` (`1920 ÷ 100`) | `px ÷ 19.2` | Yes — calibrated to 1920 wide |
| `vh`  | `9.11px` (`911 ÷ 100`)  | `px ÷ 9.11` | Yes — calibrated to 911 tall |

Every value in the tables renders exactly as it does today at 1920×911. Only the
viewport-calibrated (`vh`/`vw`/`clamp`) rows behave differently on other screens — that is the
point of the exercise.

### Role → unit policy (the hybrid rule)

| Role | Unit | Why |
|------|------|-----|
| Type (`font-size`) | `rem` | Scales with user zoom; screen-independent; keeps text legible on small screens (raw `vw` type does not) |
| Control / component sizes (button & input heights, stepper, switch, checkbox, chip/tab/accordion padding, icon glyphs, RSB card min-height, legend swatch) | `rem` | Components should be a fixed *density*, not stretch with the window |
| Structural spacing (content padding, card gap, section gap, card padding) | `rem` | Consistent rhythm regardless of viewport |
| Border widths (`1px`) | **keep `px`** | Hairlines; `rem` causes sub-pixel blur |
| Radii | `rem` | …**except** `999px` pill and `50%` circle → keep as-is (they mean "fully round", not a measure) |
| Layout **heights** (map wells, scroll caps, full-height rows) | `clamp()` / `min()` with `vh` + `rem` bounds | Should track viewport *height* — this is what fixes the short/tall aspect-ratio breakage |
| Layout **widths** (sidebar, side panels) | fixed `rem` **or** `clamp()` with `vw` + `rem` caps | **Never raw `vw`** — a sidebar in raw `vw` balloons on ultrawide |
| Already-relative (`flex:1`, `1fr`, `minmax(0,1fr)`, `minHeight:0`) | leave untouched | Already fluid; converting them breaks the flex math |

---

### A. Density table — `px → rem` (screen-independent; safe to apply anywhere)

These have **no reference-viewport dependency** — `px ÷ 16` is exact. Applying these alone
changes *nothing* visually at any screen size; it just future-proofs zoom/accessibility.

| px | rem | What uses it | Source |
|----|-----|--------------|--------|
| 12 | `0.75rem` | Caption type; sort glyph `↕`; collapse chevron `›`; legend label; dist-tooltip text; map metric caption | guide §1/§12/§13; `paV2Primitives` L128–136 |
| 13 | `0.8125rem` | Dense attribute-tab padding-x | guide §6; `paV2Primitives:144` |
| 14 | `0.875rem` | Real expand/collapse chevron `14×14`; switch thumb travel `translateX(14px)`; Treatment photo-column gap | guide §1a/§7/§14; `paV2Primitives:230`; `TreatmentDetailLayoutV2:418` |
| 16 | `1rem` | **Base type** (body, buttons, inputs, tabs, labels, chips, table headers); card gap; switch track height; checkbox `16×16` | guide §1/§7; `designTokens.CARD_GAP` |
| 18 | `1.125rem` | Section gap; map collapse-rail width; stepper ▲▼ arrow-column width | guide §0/§13/§15 |
| 20 | `1.25rem` | **Title type**; standard card padding | guide §1/§2 |
| 28 | `1.75rem` | Crash-type icon image height (RSB card) | `TreatmentDetailLayoutV2:589` |
| 30 | `1.875rem` | Stepper box height; switch track width (`30×16`) | guide §15/§7 |
| 35 | `2.1875rem` | Table row `min-height` | guide §7; `ProjectsLayoutV2:442`, `CreateProjectLayoutV2:276` |
| 40 | `2.5rem` | **Button / input / segmented-control / tag-input height** | guide §4/§5/§9; `paV2Primitives:68`; `ProjectsLayoutV2:204` |
| 58 | `3.625rem` | RSB / crash-type card `min-height` | guide §11; `CodingLayoutV2:401/409`, `TreatmentDetailLayoutV2:586` |
| 194 | `12.125rem` | Fixed commit/cancel & "Create Project" button width | guide §4; `ProjectsLayoutV2:331`, `CreateProjectLayoutV2:402/419` |
| **Sub-tokens** | | | |
| 2 | `0.125rem` | Checkbox radius; legend-swatch radius; switch thumb inset | guide §7/§12 |
| 4 | `0.25rem` | TRC chip radius; chip/pill padding-y | guide §10 |
| 6 | `0.375rem` | **`RADIUS`** (card/button/input/tab); inline-select chevron height (`9×6`) | `designTokens.RADIUS`; guide §2 |
| 8 | `0.5rem` | Tab padding-y; table-row padding-y; stepper glyph; common small gap | guide §6/§7 |
| 9 | `0.5625rem` | Legend swatch (`9×9`); inline-select chevron width | guide §12/§1a |
| 10 | `0.625rem` | Accordion header padding-y (`10px 14px`) | guide §14 |
| 12 | `0.75rem` | Switch thumb size; min card padding | guide §7/§2 |

**Compound padding tokens** (both axes → rem):

| Current | → rem | Where |
|---------|-------|-------|
| `0 16px` | `0 1rem` | Inline button padding | 
| `8px 12px` | `0.5rem 0.75rem` | Text input / table-row padding |
| `6px 9px` | `0.375rem 0.5625rem` | Inline select field |
| `8px 16px` | `0.5rem 1rem` | Wide tab |
| `8px 13px` | `0.5rem 0.8125rem` | Dense attribute tab |
| `10px 14px` | `0.625rem 0.875rem` | Accordion header |
| `8px 10px` | `0.5rem 0.625rem` | RSB card padding |
| `4px 9px` / `4px 12px` / `4px 10px` | `0.25rem 0.5625rem` / `0.25rem 0.75rem` / `0.25rem 0.625rem` | TRC chip / tag pill / validation chip |
| `32px 16px` | `2rem 1rem` | Sidebar padding |
| `32` | `2rem` | **`CONTENT_PADDING`** (screen content padding) |

---

### B. Spatial / layout table — `px → viewport-calibrated` (needs the 1920×911 basis)

These are the ones that actually cause the aspect-ratio breakage. `clamp(min, preferred, max)`
keeps them legible/usable at extremes; the `preferred` term is calibrated to hit today's px at
1920×911.

| Element | File : line | Current | Recommended | Math (@911h / 1920w) |
|---------|-------------|---------|-------------|----------------------|
| Treatment map wells (×2) | `TreatmentDetailLayoutV2:35,383,401` | `MAP_H = 280` | `clamp(11.25rem, 30.7vh, 20rem)` | 280 ÷ 9.11 = 30.7vh |
| Treatment "By Treatment" list scroll cap | `TreatmentDetailLayoutV2:465` | `maxHeight: 300` | `min(18.75rem, 32.9vh)` | 300 ÷ 9.11 = 32.9vh |
| Treatment body grid | `TreatmentDetailLayoutV2:415` | `minmax(0,1fr) minmax(0,1fr)` | **keep** (already fluid) — but see §E collapse note | — |
| PA maps row height | `PathAnalysisLayoutV2:83` | `clamp(520px, calc(100vh - 152px), 900px)` | **already hybrid ✓** — the reference pattern. Optional rem bounds: `clamp(32.5rem, calc(100vh - 9.5rem), 56.25rem)` | 520/900 → 32.5/56.25rem; 152 → 9.5rem |
| PA left/right panel floors | `PathAnalysisLayoutV2:150,182` | `minHeight: 420` | prefer letting the row's `clamp` height drive; if a floor is needed → `26.25rem` | 420 ÷ 9.11 = 46.1vh |
| Coding maps/attribute region | `CodingLayoutV2:241` | `height: calc(100vh - 180px)` | `calc(100vh - 11.25rem)` | 180 → 11.25rem |
| Coding image well | `CodingLayoutV2:419` | `minHeight: 300` | `clamp(12.5rem, 32.9vh, 18.75rem)` | 300 ÷ 9.11 = 32.9vh |
| Coding attributes panel | `CodingLayoutV2:485` | `minHeight: 480` | `30rem` floor, or clamp if it should shrink | 480 ÷ 9.11 = 52.7vh |
| Projects table card floor | `ProjectsLayoutV2:375` | `minHeight: 280` | `clamp(17.5rem, 30.7vh, 26.25rem)` | 280 ÷ 9.11 = 30.7vh |
| Projects tag dropdown cap | `ProjectsLayoutV2:291` | `maxHeight: 220` | `min(13.75rem, 24.2vh)` | 220 ÷ 9.11 = 24.2vh |
| CreateProject dropdown cap | `CreateProjectLayoutV2:366` | `maxHeight: 220` | `min(13.75rem, 24.2vh)` | 220 ÷ 9.11 = 24.2vh |
| Attribute-select dropdown cap (shared) | `TreatmentPage/components/AttributesDropdown:304` | `maxHeight: 250` | `min(15.625rem, 27.4vh)` | 250 ÷ 9.11 = 27.4vh |
| Sidebar width | guide §8; `designTokens.SIDEBAR_WIDTH = 280` | `280` | fixed `17.5rem` **(recommended)** or `clamp(16rem, 14.6vw, 20rem)` | 280 ÷ 19.2 = 14.6vw |
| Layer View side panel width | guide §13 | `340` | fixed `21.25rem` or `clamp(18rem, 17.7vw, 22rem)` | 340 ÷ 19.2 = 17.7vw |

---

### C. Per-page layout roots & `calc()` chrome offsets

| Page | File : line | Root height | Chrome offset above the fluid region |
|------|-------------|-------------|--------------------------------------|
| Projects | `ProjectsLayoutV2:164` | `height: 100vh` (+`overflow:hidden`) | — |
| Create Project | `CreateProjectLayoutV2:149` | `height: 100vh` | — |
| Help | `HelpPageLayoutV2:92` | `height: 100vh` | — |
| Treatment | `TreatmentDetailLayoutV2:310` | `minHeight: 100vh` | — |
| Coding | `CodingLayoutV2:234/304` | `minHeight: 100vh` | inner `calc(100vh - 180px)` → `- 11.25rem` |
| Path Analysis | `PathAnalysisLayoutV2:57` | `minHeight: 100vh` | maps row `calc(100vh - 152px)` → `- 9.5rem` |

The `152` and `180` offsets = content padding (`32`) + that page's header/tab-row stack. Express
the **offset itself in `rem`** so it tracks type scaling; recompute if the header height changes.

---

### D. Do **not** convert (leave as-is)

- **`1px` borders** everywhere — hairlines; `rem` blurs them.
- **`borderRadius: 999`** (pills, switch track) and **`50%`** (switch thumb) — semantic "round", not a measure.
- **`flex:1`, `flex:"0 0 auto"`, `minHeight:0`, `1fr`, `minmax(0,1fr)`** — already relative; these are the machinery that *makes* the layout fluid. Converting them breaks the space distribution.
- **`100vh` / `60vh`** roots/spinners — already viewport-relative (but see the `dvh` note in §E).

---

### E. Notes & gotchas

1. **`rem` assumes root `font-size: 16px`.** The canvas root sets `color` but if any global
   `font-size` is introduced, *every* `rem` value shifts proportionally. Verify before applying.
2. **`100vh` → `100dvh`** is recommended (avoids the mobile URL-bar jump). Desktop is identical,
   so this is low priority for an internal tool but free to adopt.
3. **Widths must never be raw `vw`.** A sidebar at `14.6vw` looks right at 1920 but becomes
   ~47rem on a 3440 ultrawide. Use fixed `rem` or `clamp()` with `rem` caps.
4. **`minHeight` floors fight short screens.** The `420` / `480` / `280` floors force scrollbars
   on a short window regardless of unit. The durable fix is *parent-driven* `clamp()` height +
   `minHeight:0` children (the pattern PA's maps row already uses), not a taller floor.
5. **The 50/50 grids (`1fr 1fr`, `minmax(0,1fr)…`) are fluid in width but never collapse.** On a
   narrow/portrait viewport they stay two columns and crush. Converting units won't fix that —
   they need a breakpoint / container query to stack to one column (out of scope for this
   catalog; noted so it isn't mistaken for a units problem — it isn't).
6. **Fluid type is intentionally *not* applied here.** Titles could become
   `clamp(1.125rem, …, 1.25rem)`, but that would alter the look at non-reference widths. This
   pass keeps all type at exact `rem` to honour "don't change how it looks for me."
