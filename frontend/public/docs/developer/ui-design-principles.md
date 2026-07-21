# 11. UI Design Principles

PSAT's v2 frontend is built on one architecture and one design system. This section distils the
standing rules any contributor (human or agent) must follow when touching `frontend/src/`. It is
condensed from the full living rulebook, **`UI_V2_REDESIGN_GUIDE.md`** (repo root) — that file also
carries the page-by-page migration log, the responsive-unit conversion catalogue, and dated
implementation history; treat it as the canonical, up-to-date source and this section as the quick
reference.

---

## Table of Contents

- [11.1 Why this section exists](#111-why-this-section-exists)
- [11.2 The Ten Rules](#112-the-ten-rules)
- [11.3 What the v2 redesign is (and isn't)](#113-what-the-v2-redesign-is-and-isnt)
- [11.4 Container / shell architecture](#114-container-shell-architecture)
- [11.5 Design source of truth](#115-design-source-of-truth)
- [11.6 v2 design tokens](#116-v2-design-tokens)
- [11.7 Do / Don't quick reference](#117-do-dont-quick-reference)

---

## 11.1 Why this section exists

Most damage to a design system comes not from big rewrites but from small, well-meaning drive-by
changes — a button dropped straight into a layout, a hardcoded hex, a bespoke switch, an `onClick`
that calls an API directly. Each change is individually harmless and collectively turns the
codebase back into spaghetti. The rules below exist to stop that; "it's just a small change" is
exactly the case they're for.

## 11.2 The Ten Rules

1. **The container/shell seam is law.** Every redesigned page is a **container** (the page file,
   e.g. `treatmentDetailPage.tsx`) that owns all logic — data fetching, hooks, `useState` for
   server data, sessionStorage, `projectDataCache`, every callback — and assembles it into one
   typed **view-model** (`*ViewModel.ts`). The **shell** (`*LayoutV2.tsx`) is a pure function of
   that view-model. See [§11.4](#114-container-shell-architecture).
2. **A shell may never fetch, own server state, or touch sessionStorage.** Local *presentational*
   state (an accordion's open/closed, a hovered bar) is fine; anything that survives a remount or
   hits the network belongs in the container.
3. **Never "just add a button."** A new control must call a view-model callback (or dispatch an
   established `window` event: `psat:save`, `psat:discard`, `psat:autocode:one`,
   `psat:autocode:by-field`, `psat:treat:all:completed`, …). If the callback doesn't exist yet, add
   it to the container and the `*ViewModel.ts` interface, then consume it in the shell. An inline
   `onClick` that navigates, calls an API, or mutates state directly bypasses the seam and the
   cross-page contracts.
4. **Reuse the shared primitives; do not reinvent chrome.** Canonical implementations live in
   `frontend/src/pages/PathAnalysisPage/components/paV2Primitives.tsx` (`V2Switch`, `V2Segmented`,
   `v2TabStyle`, `v2TabRowStyle`, `v2CardStyle`, `AccordionSection`, `DistTooltipBox`) and
   `frontend/src/features/ui/designTokens.ts`. Do not hand-roll a toggle, tab, card, or tooltip.
5. **Tokens, never magic values.** All colour/spacing/radius/type come from `designTokens.ts`
   (`COLOR`, `FONT`, `RADIUS`, `CONTENT_PADDING`, `CATEGORICAL`), `DESIGN_GUIDE.md`, and
   `colorConstants.ts` (risk-band hues). Never write a raw hex (especially `#000` — darkest text
   is `#2D3748`), a bespoke font size, or a px literal that bypasses the responsive-unit system.
6. **Scope = colour, and it is meaningful.** Blue `#3182CE` = **local** action (acts on one
   segment/selection). Teal `#319795` = **global** action (acts on the whole project / all
   projects). A primary button's colour must match its scope.
7. **Shared heavy components use the gated `variant="v2"` pattern.** When one component serves
   both UIs (`GeoDataPanel`, `AttributesPanel`, `PathAnalysisMapView`, `FilterPanel`,
   `AggregatedScoreBandPanel`, `AggregatedTopContributorsPanel`, `AttributeDistributionChart`,
   `AutocodeValidation`, `SelectRoadsMap`, `AnalysisSidebar`, `ImagePanel`), add a `variant` branch
   with default `"v1"` that stays byte-identical. Never fork the component and never regress v1
   while both UIs are live.
8. **Every distribution readout uses `DistTooltipBox`.** Any hover that reveals count/% on a pie,
   bar, or stacked band renders the shared `DistTooltipBox`. The native `title` attribute is
   allowed only for text-truncation reveals and simple affordance hints — never for a data readout.
9. **Cross-page contracts are sacred.** sessionStorage keys, `projectDataCache` invalidation,
   navigation `state` handshakes (centralised in `frontend/src/features/projectNav.ts`), and route
   params are load-bearing and documented in the root `CLAUDE.md`. Do not rename, skip, or inline
   them — route through `projectNav.ts`.
10. **Unsaved work is guarded honestly.** A page that mutates persisted data sets
    `window.psat_hasUnsavedChanges` only when there is genuinely-unpersisted work, and listens for
    `psat:save` / `psat:discard`. Do not set the flag "just in case" — a stale flag prompts on
    unrelated pages.

## 11.3 What the v2 redesign is (and isn't)

- **Is:** the same components (plus a few new ones) in a new arrangement, on the same routes. Plus
  app-global changes — a light-only theme (dark mode removed) and a restructured sidebar with
  route-specific controls moved onto each page's canvas.
- **Isn't:** a rewrite of the underlying components, and not a set of duplicate `/new/*` routes.
  There are no parallel routes.

**Mental model — siblings, not layers.** v2 does not load v1 underneath and re-skin it. v1 and v2
are interchangeable siblings; exactly one renders at a time. They share the container above them,
never each other:

```
ProjectsContainer  (logic: fetch, hooks, sessionStorage, callbacks)
        │  assembles ONE typed props object (the view-model)
        │
        ├── useUiVersion() === 'v1'  →  <ProjectsLayoutV1 {...vm} />
        └── useUiVersion() === 'v2'  →  <ProjectsLayoutV2 {...vm} />
```

An overlay would leave v1's DOM mounted (double-mounted maps, duplicated state, CSS fights,
pointer-events/modal-freeze-class bugs). Siblings mean v1's tree simply isn't on the page in v2
mode, and "done" means deleting v1 cleanly once it's no longer needed.

## 11.4 Container / shell architecture

| Part | Owns | Who edits it | Conflict risk |
|------|------|---------------|----------------|
| **Container** (existing page file) | data fetch, hooks, sessionStorage/cache contracts, all callbacks, building the view-model | the team (bugfixes) + one-time hoist | shared file — touch minimally |
| **Layout shell** (new file) | pure presentation — arranges existing components, wires them to view-model props | shell author only | new file → ~zero conflict |

- **Rule 1 — the prop-contract is the seam.** The container assembles one typed view-model object
  and passes it to whichever shell is active. v1 and v2 shells consume identical props. Define this
  interface explicitly per page — it is the contract logic changes and layout changes meet at.
- **Rule 2 — new components get their data from the container, never their own fetch.** If a new
  component needs backend data, the container fetches it (through the existing hooks /
  `projectDataCache`) and passes it down as part of the view-model.
- **Rule 3 — swap = flip default, then delete.** Once v2 is the settled default and stable, remove
  each `*LayoutV1.tsx`, drop the `ui === "v2" ? ... : ...` branch in each container, and remove the
  gated v1 branches in `provider.tsx` / `AppLayout.tsx` / `Sidebar.tsx`.

## 11.5 Design source of truth

The visual design ships as a design package (comps, screenshots, brand assets) alongside a
normative design-system spec:

| File / folder | Role | How to use it |
|---|---|---|
| `DESIGN_GUIDE.md` | Normative design system — the single source of truth for tokens, type, spacing, components | Obey it. Map its tokens to Chakra (§11.6). "If a screen disagrees with this doc, the screen is wrong." |
| `*.dc.html` comps (per-page mockups) | Visual comps of each screen's new arrangement | Read the inline styles/structure as the layout target. Translate to Chakra/React — do **not** port the mockup runtime (`<x-dc>`, `{{ binding }}`, `DCLogic`, `support.js`, etc.) |
| `screenshots/` | Rendered references of the comps | Sanity-check the built shell against intent |
| `assets/psat-logo.png` | Brand asset | Use where the sidebar/landing needs the logo |

Comps are fixed-size mockups (e.g. `1920×900`); React shells must be fluid/responsive, never
pixel-frozen.

## 11.6 v2 design tokens

`DESIGN_GUIDE.md` makes the light-only theme concrete. Key values the v2 theme encodes:

- **Font:** Inter (400 / 500 / 700 only — no 600).
- **Surfaces / text:** canvas `#F7FAFC`; cards `#fff` + `1px #E2E8F0` border + `6px` radius;
  darkest text `#2D3748` (never `#000`). These map to Chakra `gray.*` values — prefer the tokens.
- **Accent = scope, not decoration:** blue `#3182CE` = local (acts on one segment/selection); teal
  `#319795` = global (acts on the project / all). This drives primary-button colour choice.
- **RSB risk hues are unchanged:** green `#87c424` / yellow `#ffcc1a` / orange-red `#ff5b1a` /
  purple `#cd1aff` — these already match
  `frontend/src/components/visualization/scoreband/colorConstants.ts`. Reuse that file; do not
  redefine them in the theme.

Full normative detail (spacing, buttons, tabs, switches, chips, cards) lives in `DESIGN_GUIDE.md` —
treat it as the spec, not something to re-derive here.

## 11.7 Do / Don't quick reference

**Do**
- Keep the container as the single owner of server state, sessionStorage keys, and cache.
- Pass everything to shells via the typed view-model.
- Build v2 shells as new files; debug live with `?ui=v2`.
- Gate global seams once, at the root, behind the same flag.
- Treat `DESIGN_GUIDE.md` as the spec; reuse `colorConstants.ts` for RSB hues.

**Don't**
- Don't port the `.dc.html` mockup runtime — translate the visual intent to Chakra/React and get
  behaviour from the container.
- Don't reproduce the comps' fixed sizing — shells must be fluid.
- Don't create `/new/*` routes or duplicate the container.
- Don't let a shell fetch data, own server state, or touch sessionStorage directly.
- Don't delete dark mode, `_dark` props, or the old sidebar while both UIs are live — neutralize
  via the v2 theme/flag; delete at swap.
- Don't try to hot-swap the theme without a reload.
- Don't change route params or sessionStorage key names — deep links and cross-page contracts
  depend on them (see the root `CLAUDE.md`).
