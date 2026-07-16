# In-Image Path Measurement (Single-View Metrology) — Developer Reference

> **Purpose of this document.** A technical reference and handoff for two readers:
> **(a)** whoever writes the user-facing documentation — see [§3 How it works](#3-how-it-works-for-the-user-doc-writer)
> and [§4 Accuracy & limits](#4-accuracy--honest-limits); **(b)** the next engineer/agent
> refining the feature — see [§5 Architecture](#5-architecture) onward.
>
> **Status: prototype-complete, integrated into the Coding page, math verified, not yet
> click-through tested in a live browser.** This is not finished production work — read
> [§2 Status](#2-status) and [§8 Known issues & open work](#8-known-issues--open-work).
>
> **Living design log:** `temp/IN_IMAGE_METROLOGY_FEATURE.md` (untracked) holds the full
> chronological decision history. This doc is the distilled reference; that file is the "why".

---

## 1. What it is

A tool that lets a planner **measure real-world distances directly on a street-level survey
frame** — how many metres of clear width sit either side of a path before hitting a tree, drain,
railing, or kerb. The purpose is judging whether a path can be **widened** or have a **cycling
lane added**, against real physical obstructions that the top-down GIS width layers do not capture
(and which those layers are known to get wrong).

It works by recovering a **pixel → ground-metres** mapping for a frame, then painting a metric
grid / ruler on the photo. The reliable path derives that mapping **exactly** from a drain grating
of known size that the user clicks; manual dials cover frames without a grating.

**Scope:** widths on the ground plane only. No heights, no overhead clearance (deliberately
deferred). Live on-screen read-off only — measurements are **not** saved to the segment in this
version (persistence was designed-for but deferred).

---

## 2. Status

| Area | State |
|---|---|
| Geometry / math | ✅ Built and **verified exact** (see [§6](#6-the-math)) |
| Calibration (rig constants) | ⚠️ **Best-effort, not final.** Derived from scene, not a known mount. See [§7](#7-calibration-constants) |
| Standalone prototype | 🗑 Removed 2026-07-16 (served its purpose; math ported to `measureMath.ts`) |
| Coding-page integration | ✅ Built, types clean, builds & serves |
| Live click-through test | ❌ **Not done** — needs browser + backend; do this first ([§8](#8-known-issues--open-work)) |
| Automatic roll (drain-less frames) | ❌ Not built — manual dials only (see [§8](#8-known-issues--open-work)) |
| Persistence / report flow | ❌ Deferred by design |
| Auto-detect gratings | ❌ Future (manual click for now) |

---

## 3. How it works (for the user-doc writer)

**Entry point:** Coding page → the street-view image panel → **📐 Measure** button in its header
→ a full-screen measurement window opens for the current segment. (Disabled when the segment has
no image.)

**The reliable workflow — anchor on a known object:**
1. Pick the anchor type: **Drain / Tactile / Custom** (added 2026-07-16).
   - **Drain** — size dropdown of standard gratings (defaults to the standard **700 × 850 mm —
     the 700 mm edge faces you** on typical path drains; corrected 2026-07-16, the design log
     previously claimed the long edge faces the camera).
   - **Tactile** — the yellow tiles at every crossing: **300 × 300 mm per tile**, with whole-mat
     options (600 × 600, 900 × 900, …) — outline a full mat when visible; a bigger anchor is
     more accurate.
   - **Custom** — enter any known flat rectangle's size in mm (near edge × side edge), e.g.
     ground signage. It must lie **flat on the ground**.
2. Click the object's four outline corners in order: **near-left → near-right → far-right
   → far-left** ("near" = the edge closest to the camera). The order is displayed persistently
   in the panel and the status line counts each corner as you click.
3. The grid snaps to an **exact** solution and the tool switches straight to the Ruler.

**Measuring (2026-07-16: ruler-only — the Grid and Two-point modes were removed):**
- **Ruler** — click the path edge you're widening *from*, then the obstacle; it reads the **clear
  width** between them. The 1 m × 1 m grid is still painted as a visual reference for
  square-counting, and it extends back toward the camera when the anchor sits further out
  (behind-camera geometry is clipped, not wrapped).

**Frames with no drain:** use the manual dials (Yaw, k1, Pitch, Height, Roll) to line the grid up
by eye. Less accurate; see the caveats. This is the fallback, not the main path.

**Key UX facts to document:**
- Every measurement shows a **± uncertainty band**, never a bare number. This is deliberate — the
  tool is planning-grade, not survey-grade.
- Reliability is highest in the **near field (~0–3 m in front of the camera)**. Beyond ~3 m the
  overlay de-emphasises and a warning appears; treat far readings as soft.
- **Yaw** spins the grid to run down the path (the bike doesn't always point straight down it).
  Yaw is a pure rotation — it never changes a measured distance.

---

## 4. Accuracy & honest limits

Communicate these plainly to planners; the tool must not imply false precision.

- **Planning-grade: ~±0.4–0.5 m in the near field.** The original ±0.25 m target was dropped —
  the imagery is only **640×457 px, EXIF-stripped, single "Cam4" view, no higher-res available**,
  which caps achievable precision.
- **Anchored (drain) measurements are the accurate ones.** In calibration, the anchor method
  measured *unseen* gratings to a median **~91 mm** error. Manual-dial measurements are looser.
- **Near field only.** Precision falls off fast toward the horizon as pixels compress. Trust the
  ~0–3 m zone; flag beyond.
- **Flat-ground assumption.** The method assumes the ground is a single flat plane. Slopes,
  camber, and measuring across a kerb onto a raised verge degrade it. PSAT already tracks
  gradient/curvature per segment — a future version can auto-raise the uncertainty there.
- **The GIS width layers are the thing this tool exists to distrust.** If the tool and GIS
  disagree, that is not automatically the tool being wrong — that disagreement is the point of the
  feature. Validate against tape-measured ground truth, not against GIS.

---

## 5. Architecture

Frontend-only. No backend changes (calibration constants are fixed and baked into the frontend;
persistence is deferred, so nothing is written).

```
frontend/src/pages/CodingPage/components/
├─ ImagePanel.tsx                     ← adds the "📐 Measure" button (reused by v1 AND v2 layouts)
└─ MeasureMode/
   ├─ measureMath.ts                  ← PURE geometry. Single source of truth for rig constants.
   └─ MeasureModal.tsx                ← the tool: portal modal, canvas overlay, dials, read-off
```

**Why it hangs off `ImagePanel`:** ImagePanel is the per-segment street-view component, reused by
**both** the v1 and v2 Coding layouts. Adding the button there makes the tool appear in both with
**zero changes to layout chrome** — respecting the v2 container/shell seam (see
`frontend/CLAUDE.md`).

**Why a portal modal, not a Chakra `Dialog`:** Chakra/Zag `Dialog` has a documented
pointer-events freeze-after-close bug (see the root `CLAUDE.md`). `MeasureModal` renders via
`createPortal` to `document.body` with a plain fixed overlay — no Zag, no freeze risk.

**Data flow:**
1. Modal loads the frame from the same URL ImagePanel uses:
   `/api/projects/<project>/images/<imageRef>` (proxied to the backend on `:8000`).
2. The image is drawn onto a `<canvas>` sized `IMG_W·S × IMG_H·S` (S = display scale). Because the
   component draws the image itself, the **native-pixel ↔ display-pixel mapping is exact and
   known** — this is what makes click coordinates reliable regardless of CSS sizing.
3. Clicks convert display px → native px (correcting for CSS scale via `canvas.width/rect.width`),
   then native px → ground metres via `measureMath`.
4. All overlay geometry is computed by `measureMath` and drawn on the canvas. Read-off is derived
   React state (no DOM poking).

**State (in `MeasureModal`):** `rig` (the full projection state), `mode` (anchor/ruler),
`picks` (ground points), `anchorPts` (clicked corners), `anchorType` (drain/tactile/custom) with
`sizeIdx`/`tactileIdx`/`customNear`/`customSide`, `anchored`. All size/type controls pass the
size **explicitly** into `doSolveAnchor` — never read from state inside it (stale-render bug,
fixed 2026-07-16). Moving **yaw/k1** keeps the exact anchor; moving **pitch/height/roll**
"breaks" to manual (clears the anchor homography) — the modal states this in its UI.

---

## 6. The math

All in `measureMath.ts`, ported **verbatim** from the validated prototype and re-verified after the
port (exact anchor solve to 6e-13 mm; px→ground→px round-trip exact over all 95,220 clickable
pixels of the 18 test gratings).

**Coordinate frames:** world x=right, y=forward(away from camera), z=up; camera X=right, Y=down,
Z=forward. Ground plane is z=0.

**Two projection modes, same interface (`groundToPx` / `pxToGround`):**

1. **Anchored (exact).** Four clicked grating corners ↔ the known metric rectangle give a 3×3
   **homography** (DLT + Gaussian elimination). This *is* the ground plane for that frame — no
   camera pose needed. Distortion is removed first (the homography is only valid on the ideal
   pinhole image), then `H` maps ideal-px ↔ ground. **Yaw** is applied on top as a pure in-plane
   rotation (a drain isn't necessarily square to the path, so yaw spins the frame onto the path
   without changing any distance). The rotation is applied as `(yaw − anchorYaw)` where
   `anchorYaw` is the decomposed yaw stored at solve time — so the grid **starts aligned with
   the grating's side edge**, and the yaw dial means the same thing in the anchored and manual
   paths (fixed 2026-07-16; previously the anchored grid started camera-aligned and jumped by
   the camera-vs-drain heading when the anchor broke to manual).

2. **Rig / manual (approximate).** When there's no anchor, the projection uses the camera pose:
   height, pitch, roll, yaw + intrinsics. `pxToGround` undistorts, back-projects the ray, and
   intersects it with z=0.

**Lens distortion.** A radial model `r·(1 + k1·r² + k2·r⁴)`. The **inverse** (distorted → ideal)
is solved by **bisection on the radius**, clamped to the model's monotonic domain. This replaced a
fixed-point iteration that *diverged* under some coefficients — do not revert it. (Full story of
that bug and others in the design log.)

**Clipping (2026-07-16, for the toward-viewer grid).** `solveAnchor` sign-normalises `H`/`Hinv`
so the homography's w-row (proportional to camera-frame depth) is positive in front of the
camera; `groundToPx` then returns `null` for behind-camera points instead of wrapping them
through the horizon, and also rejects ideal-pixel positions more than one frame outside the
image (where the radial model folds back and would draw garbage). Verified: points between
camera and a far anchor render, behind-camera clips, screen-y stays monotonic (no wrap).

**Decomposition.** When you anchor, the homography is decomposed back into pose (height/pitch/
roll/yaw) purely to **seed the dials** for display. The exact **matrix keeps driving the
projection** while untouched; only if you move pitch/height/roll does it fall back to the pose path
(which costs ~35 mm, because clicked-corner noise means the homography doesn't correspond to any
*exact* real camera pose — this is expected and documented).

---

## 7. Calibration constants

**These are the single most important thing for the next engineer to understand, and the least
finished.**

All rig constants live in **one place**: the top of `measureMath.ts` —

```ts
export const INTRINSICS   = { fx: 233.34, fy: 233.34, cx: 320, cy: 228.5, k1: -0.045, k2: 0 };
export const DEFAULT_HEIGHT = 0.725;   // metres
export const DEFAULT_PITCH  = 2.18;    // degrees down
```

**Provenance (why these numbers):**
- Recovered **from the imagery itself** — there is *no* camera spec, no EXIF, no known mount
  height. Focal & distortion came from a bundle adjustment over 18 hand-clicked gratings, then
  refined against path-edge geometry; height was hand-tuned by the user to 0.725 m against a path
  of known width.
- They are **plausible and self-consistent, but not authoritative.** Two automated fits disagreed
  (a grating-only fit and a path-edge fit) and the truth was tuned between them. Treat these as a
  good starting point, not ground truth.

**How to re-derive (scripts in repo root `scripts/`, temp — see §9):**
- `TEMP_grating_clicker.py` — click grating corners on frames → `temp/grating_anchors.json`.
- `calibrate_rig_from_anchors.py` — bundle-adjust intrinsics + height/pitch from those anchors.
  Has a physical-plausibility guard (rejects "camera pointing at the sky" degenerate fits — do
  **not** remove it, and do **not** re-enable free principal-point / free-aspect models on this
  planar data; both documented in the design log).
- `calibrate_from_path_edges.py` — refine pitch/distortion from path-edge parallelism (uses
  `path_segmentation_6July.pt`).

**When the rig is confirmed** (the surveyors are contracted and the camera/height/angle are being
held constant going forward), or if a real mount height is ever measured: update the three
constants above. **That's the only change needed** — everything downstream reads from them.
A known height in particular would collapse most of the remaining uncertainty, because it's the
single scale parameter the whole system pivots on.

**Important:** the anchor (drain) workflow **re-derives the geometry from the scene every frame**,
so it is *immune* to these constants being slightly off. The constants only matter for the
**manual/drain-less** path. Prefer anchoring wherever a grating is visible.

---

## 8. Known issues & open work (for the refining agent)

**Do first — the one unverified thing:**
- **Live click-through test.** The math and build are proven, but nobody has opened the modal on a
  real segment in a browser and clicked through it. Run backend (`:8000`) + `cd frontend && npm
  run dev`, open a segment on the Coding page, hit **📐 Measure**, click a drain's 4 corners, and
  confirm the grid lands and measurements read true. This is the gate before anyone trusts it.

**Coverage — the big functional gap:**
- **Automatic roll for drain-less frames is not built.** Roll (bike lean) varies ±20° frame to
  frame and is the one parameter that can't be a constant. On frames *with* a drain, anchoring
  solves it exactly. On frames *without*, the user must set it by hand — the hard dial, because
  the horizon is usually hidden behind trees. A first automatic attempt (averaging vertical-line
  angles) **failed** at 8.9° RMS due to a real bug (perspective makes plumb verticals converge, so
  their image angles must not be averaged). The correct approaches, in order of promise:
  1. **Path-edge vanishing point** — `path_segmentation_6July.pt` already segments the path edges
     in ~every frame; with pitch known as a constant, one horizon point pins roll. Best coverage
     (it's a path survey).
  2. **Vertical VP via RANSAC** — fixes the actual bug, but the cue is absent in ~20% of frames
     (open park), so it can't stand alone.
  Landing (1) would take the tool from ~20–40% coverage (drain frames) to ~100%.

**Accuracy refinements:**
- **Per-frame height/pitch freedom.** ~11% of frames carry larger error because bike lean also
  *lowers and tilts* the camera, but the model currently lets only roll vary. Freeing height/pitch
  per frame (or flagging slopes via PSAT's gradient/curvature) is the next accuracy win — a
  tighter trusted zone is *not* (error doesn't correlate with distance the way first assumed).
- **Confirm/replace the calibration constants** once the rig is verified (see §7).

**Fixed in the 2026-07-16 refining pass** (kept for context; do not re-break):
- *Stale size dropdown* — changing the grating size after clicking corners re-solved with the
  previous size (React stale state in `doSolveAnchor`); the size is now passed explicitly.
- *Decomposed yaw sign* — `decomposeAnchor` returned the camera heading un-negated, but `camR`
  applies `rotZ(−yaw)`; pose renders with dials=decomp were mirrored (2×yaw off on skewed drains).
- *Anchored yaw semantics* — the anchored path rotated by the absolute dial value, so the grid
  seeded to camera-aligned instead of grating-aligned ("grid diagonal across the drain") and
  jumped on anchor-break. Now rotates by `(yaw − anchorYaw)`.
  All three verified by simulation (exact grating-edge alignment, anchored/pose parity, anchor
  residual < 1e-9 mm, round-trip and yaw-distance-preservation still machine-exact).

**Productisation:**
- **Custom known-size anchors — SHIPPED 2026-07-16** (basic version, pulled forward from the
  backlog): anchor-type selector Drain / Tactile (300 mm tiles + mat multiples) / Custom
  (near × side mm inputs). Remaining follow-ups: a user-managed list of *saved* reference
  objects, and presets from the §6.6 anchor catalogue in the design log (drain cover slabs,
  cycling-path logos, zebra stripes, car park lots — dims pending user verification).
- **Persistence** — architected-for but deferred. Save the ruler read-off (clear width L/R) onto
  the segment and flow it into reports. Reserve attribute keys but don't write yet. The exact
  `{H, tier, anchorCorners}` from a solve is serialisable enough to reproduce a measurement.
- **Auto-detect gratings** — a YOLO class for the standard 850×700 grating (orientation is
  predictable: long edge across the path, per the surveyors). Would remove the manual 4-click.
- **Cosmetic cleanup** — the prototype header still says "calibrated from 18 drain gratings" and a
  k1 hint references the old −0.073 value; both are stale leftovers.

---

## 9. Temp artefacts (delete before ship)

Tracked in full in `temp/IN_IMAGE_METROLOGY_FEATURE.md §11`. Summary:

| Path | What | Remove when |
|---|---|---|
| ~~`prototype/metrology/`~~ | Standalone browser prototype | ✅ **Removed 2026-07-16** (math lives on in `measureMath.ts`) |
| `scripts/TEMP_grating_clicker.py` | Grating corner clicker | Calibration constants are final |
| `scripts/calibrate_rig_from_anchors.py` | Bundle-adjust calibration | Keep while rig may change |
| `scripts/calibrate_from_path_edges.py` | Path-edge refinement | Keep while rig may change |
| `scripts/validate_roll_estimator.py` | Proved auto-roll fails | Keep while auto-roll is on the table |
| `temp/grating_anchors.json`, `temp/rig_calibration*.json`, `temp/distortion_from_lines.json` | Calibration data/outputs | Once constants are baked & final |

**Production code (keep):** everything under
`frontend/src/pages/CodingPage/components/MeasureMode/` and the ImagePanel button.

---

## 10. References

- **Design log (full history & rationale):** `temp/IN_IMAGE_METROLOGY_FEATURE.md`
- **Core math:** `frontend/src/pages/CodingPage/components/MeasureMode/measureMath.ts`
- **UI:** `frontend/src/pages/CodingPage/components/MeasureMode/MeasureModal.tsx`
- **Frontend v2 conventions:** `frontend/CLAUDE.md`
- **Path segmentation model (for the path-edge roll work):**
  `backend/models/path_segmentation_6July.pt`
