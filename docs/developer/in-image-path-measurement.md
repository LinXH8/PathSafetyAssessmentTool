# 12. In-Image Path Measurement (Single-View Metrology)

A frontend-only tool, hung off the Coding page's image panel, that recovers a pixel → ground-metres
mapping for a street-level survey frame and lets a planner measure real-world clear widths directly
on the photo. This section is the developer-facing technical reference. For the workflow from a
planner's point of view, see **User Guide §7: In-Image Path Measurement**.

> **Living design log:** the full chronological decision history — including bugs found and fixed,
> rejected approaches, and calibration provenance — lives in **`docs/in-image-metrology.md`**
> (repo root `docs/`). Treat that file as the canonical, most up-to-date reference and this section
> as the condensed summary.

---

## Table of Contents

- [12.1 What it is](#121-what-it-is)
- [12.2 Status](#122-status)
- [12.3 Architecture](#123-architecture)
- [12.4 The math](#124-the-math)
- [12.5 Calibration constants](#125-calibration-constants)
- [12.6 Known issues & open work](#126-known-issues-open-work)
- [12.7 Temp artefacts](#127-temp-artefacts)
- [12.8 References](#128-references)

---

## 12.1 What it is

A tool that lets a planner measure real-world distances directly on a street-level survey frame —
how many metres of clear width sit either side of a path before hitting a tree, drain, railing, or
kerb. The purpose is judging whether a path can be widened or have a cycling lane added, against
real physical obstructions that the top-down GIS width layers do not capture (and are known to get
wrong).

It works by recovering a pixel → ground-metres mapping for a frame, then painting a metric grid /
ruler on the photo. The reliable path derives that mapping **exactly** from a drain grating of
known size that the user clicks; manual dials cover frames without a grating.

**Scope:** widths on the ground plane only. No heights, no overhead clearance (deliberately
deferred). Live on-screen read-off only — measurements are **not** saved to the segment in this
version (persistence was designed-for but deferred).

## 12.2 Status

| Area | State |
|---|---|
| Geometry / math | Built and verified exact (see [§12.4](#124-the-math)) |
| Calibration (rig constants) | Best-effort, not final — derived from scene, not a known mount ([§12.5](#125-calibration-constants)) |
| Coding-page integration | Built, types clean, builds & serves |
| Live click-through test | Not done — needs browser + backend ([§12.6](#126-known-issues-open-work)) |
| Automatic roll (drain-less frames) | Not built — manual dials only |
| Persistence / report flow | Deferred by design |
| Auto-detect gratings | Future (manual click for now) |

## 12.3 Architecture

Frontend-only. No backend changes — calibration constants are fixed and baked into the frontend;
persistence is deferred, so nothing is written.

```
frontend/src/pages/CodingPage/components/
├─ ImagePanel.tsx                     ← adds the "📐 Measure" button (reused by v1 AND v2 layouts)
└─ MeasureMode/
   ├─ measureMath.ts                  ← PURE geometry. Single source of truth for rig constants.
   └─ MeasureModal.tsx                ← the tool: portal modal, canvas overlay, dials, read-off
```

**Why it hangs off `ImagePanel`:** `ImagePanel` is the per-segment street-view component, reused by
both the v1 and v2 Coding layouts. Adding the button there makes the tool appear in both with zero
changes to layout chrome — respecting the v2 container/shell seam (see
[§11: UI Design Principles](ui-design-principles.md)).

**Why a portal modal, not a Chakra `Dialog`:** Chakra/Zag `Dialog` has a documented
pointer-events freeze-after-close bug (see the root `CLAUDE.md`). `MeasureModal` renders via
`createPortal` to `document.body` with a plain fixed overlay — no Zag, no freeze risk.

**v2 styling:** the modal chrome follows the v2 design system, copied from the canonical v2
components rather than from the design guide text alone — overlay/panel/header/close match
`ConfirmDialogV2`, the anchor-type segmented control and selects/inputs match `ShareProjectModalV2`,
buttons mirror `V2Btn`, all on `designTokens` `COLOR`/`FONT` (light-only, no dark mode). Canvas
overlay colours (`OV`) are content drawn over the photo, not chrome, and keep the risk-band hues.

**Data flow:**
1. Modal loads the frame from the same URL `ImagePanel` uses:
   `/api/projects/<project>/images/<imageRef>` (proxied to the backend on `:8000`).
2. The image is drawn onto a `<canvas>` sized `IMG_W·S × IMG_H·S` (`S` = display scale). Because
   the component draws the image itself, the native-pixel ↔ display-pixel mapping is exact and
   known — this is what makes click coordinates reliable regardless of CSS sizing.
3. Clicks convert display px → native px (correcting for CSS scale via `canvas.width/rect.width`),
   then native px → ground metres via `measureMath`.
4. All overlay geometry is computed by `measureMath` and drawn on the canvas. Read-off is derived
   React state (no DOM poking).

**State (in `MeasureModal`):** `rig` (the full projection state), `mode` (anchor/ruler), `picks`
(ground points), `anchorPts` (clicked corners), `anchorType` (drain/tactile/custom) with
`sizeIdx`/`tactileIdx`/`customNear`/`customSide`, `anchored`. All size/type controls pass the size
**explicitly** into `doSolveAnchor` — never read from state inside it (a stale-render bug, already
fixed — do not reintroduce). Moving yaw/k1 keeps the exact anchor; moving pitch/height/roll
"breaks" to manual (clears the anchor homography).

## 12.4 The math

All in `measureMath.ts`, ported verbatim from a validated prototype and re-verified after the port
(exact anchor solve to 6e-13 mm; px→ground→px round-trip exact over all 95,220 clickable pixels of
the 18 test gratings).

**Coordinate frames:** world x=right, y=forward (away from camera), z=up; camera X=right, Y=down,
Z=forward. Ground plane is z=0.

**Two projection modes, same interface (`groundToPx` / `pxToGround`):**

1. **Anchored (exact).** Four clicked grating corners ↔ the known metric rectangle give a 3×3
   homography (DLT + Gaussian elimination). This *is* the ground plane for that frame — no camera
   pose needed. Distortion is removed first (the homography is only valid on the ideal pinhole
   image), then `H` maps ideal-px ↔ ground. **Yaw** is applied on top as a pure in-plane rotation (a
   drain isn't necessarily square to the path, so yaw spins the frame onto the path without changing
   any distance) — rotation is applied as `(yaw − anchorYaw)` where `anchorYaw` is the decomposed
   yaw stored at solve time, so the grid starts aligned with the grating's side edge and the yaw
   dial means the same thing in the anchored and manual paths.
2. **Rig / manual (approximate).** When there's no anchor, the projection uses the camera pose:
   height, pitch, roll, yaw + intrinsics. `pxToGround` undistorts, back-projects the ray, and
   intersects it with z=0.

**Lens distortion.** A radial model `r·(1 + k1·r² + k2·r⁴)`. The inverse (distorted → ideal) is
solved by **bisection on the radius**, clamped to the model's monotonic domain — this replaced a
fixed-point iteration that diverged under some coefficients; do not revert it.

**Clipping (toward-viewer grid).** `solveAnchor` sign-normalises `H`/`Hinv` so the homography's
w-row (proportional to camera-frame depth) is positive in front of the camera; `groundToPx` then
returns `null` for behind-camera points instead of wrapping them through the horizon, and also
rejects ideal-pixel positions more than one frame outside the image (where the radial model folds
back and would draw garbage).

**Decomposition.** When you anchor, the homography is decomposed back into pose (height/pitch/
roll/yaw) purely to seed the dials for display. The exact matrix keeps driving the projection while
untouched; only if you move pitch/height/roll does it fall back to the pose path (which costs
~35 mm, because clicked-corner noise means the homography doesn't correspond to any exact real
camera pose — this is expected and documented).

*Layman's explanation: the tool finds a mathematical formula that converts "where a pixel is in the
photo" into "how many metres away that point is on the ground," using a known-size object (like a
drain cover) in the photo as a ruler. Once it has that formula, it can measure the gap between the
path edge and any obstacle just by where they appear in the picture.*

## 12.5 Calibration constants

**These are the single most important thing for the next engineer to understand, and the least
finished.**

All rig constants live in one place: the top of `measureMath.ts`:

```ts
export const INTRINSICS   = { fx: 233.34, fy: 233.34, cx: 320, cy: 228.5, k1: -0.045, k2: 0 };
export const DEFAULT_HEIGHT = 0.725;   // metres
export const DEFAULT_PITCH  = 2.18;    // degrees down
```

**Provenance (why these numbers):**
- Recovered from the imagery itself — there is no camera spec, no EXIF, no known mount height.
  Focal & distortion came from a bundle adjustment over 18 hand-clicked gratings, then refined
  against path-edge geometry; height was hand-tuned against a path of known width.
- They are plausible and self-consistent, but not authoritative. Two automated fits disagreed (a
  grating-only fit and a path-edge fit) and the truth was tuned between them. Treat these as a good
  starting point, not ground truth.

**How to re-derive (scripts in repo root `scripts/`, temp — see [§12.7](#127-temp-artefacts)):**
- `TEMP_grating_clicker.py` — click grating corners on frames → `temp/grating_anchors.json`.
- `calibrate_rig_from_anchors.py` — bundle-adjust intrinsics + height/pitch from those anchors. Has
  a physical-plausibility guard (rejects "camera pointing at the sky" degenerate fits) — do not
  remove it, and do not re-enable free principal-point / free-aspect models on this planar data.
- `calibrate_from_path_edges.py` — refine pitch/distortion from path-edge parallelism (uses
  `path_segmentation_6July.pt`).

**When the rig is confirmed** (or if a real mount height is ever measured), update the three
constants above — that's the only change needed; everything downstream reads from them. A known
height in particular would collapse most of the remaining uncertainty, because it's the single
scale parameter the whole system pivots on.

**Important:** the anchor (drain) workflow re-derives the geometry from the scene every frame, so
it is immune to these constants being slightly off. The constants only matter for the
manual/drain-less path. Prefer anchoring wherever a grating is visible.

## 12.6 Known issues & open work

**Do first — the one unverified thing:**
- **Live click-through test.** The math and build are proven, but nobody has opened the modal on a
  real segment in a browser and clicked through it. Run backend (`:8000`) + `cd frontend && npm run
  dev`, open a segment on the Coding page, hit 📐 Measure, click a drain's 4 corners, and confirm
  the grid lands and measurements read true. This is the gate before anyone trusts it.

**Coverage — the big functional gap:**
- **Automatic roll for drain-less frames is not built.** Roll (bike lean) varies ±20° frame to
  frame and is the one parameter that can't be a constant. On frames with a drain, anchoring solves
  it exactly. On frames without, the user must set it by hand. A first automatic attempt (averaging
  vertical-line angles) failed at 8.9° RMS (perspective makes plumb verticals converge, so their
  image angles must not be averaged). The correct approaches, in order of promise:
  1. **Path-edge vanishing point** — the path segmentation model already segments path edges in
     ~every frame; with pitch known as a constant, one horizon point pins roll. Best coverage.
  2. **Vertical VP via RANSAC** — fixes the actual bug, but the cue is absent in ~20% of frames
     (open park), so it can't stand alone.

**Accuracy refinements:**
- **Per-frame height/pitch freedom.** ~11% of frames carry larger error because bike lean also
  lowers and tilts the camera, but the model currently lets only roll vary. Freeing height/pitch per
  frame (or flagging slopes via PSAT's gradient/curvature) is the next accuracy win.
- **Confirm/replace the calibration constants** once the rig is verified (see [§12.5](#125-calibration-constants)).

**Productisation:**
- **Custom known-size anchors — shipped** (basic version): anchor-type selector Drain / Tactile
  (300 mm tiles + mat multiples) / Custom (near × side mm inputs). Remaining follow-ups: a
  user-managed list of saved reference objects, and additional presets (drain cover slabs, cycling
  path logos, zebra stripes, car park lots — dimensions pending user verification).
- **Persistence** — architected-for but deferred. Save the ruler read-off (clear width L/R) onto
  the segment and flow it into reports. The exact `{H, tier, anchorCorners}` from a solve is
  serialisable enough to reproduce a measurement.
- **Auto-detect gratings** — a YOLO class for the standard 850×700 grating (orientation is
  predictable: long edge across the path). Would remove the manual 4-click.

## 12.7 Temp artefacts

Tracked in full in `temp/IN_IMAGE_METROLOGY_FEATURE.md`. Summary:

| Path | What | Remove when |
|---|---|---|
| `scripts/TEMP_grating_clicker.py` | Grating corner clicker | Calibration constants are final |
| `scripts/calibrate_rig_from_anchors.py` | Bundle-adjust calibration | Keep while rig may change |
| `scripts/calibrate_from_path_edges.py` | Path-edge refinement | Keep while rig may change |
| `scripts/validate_roll_estimator.py` | Proved auto-roll fails | Keep while auto-roll is on the table |
| `temp/grating_anchors.json`, `temp/rig_calibration*.json`, `temp/distortion_from_lines.json` | Calibration data/outputs | Once constants are baked & final |

**Production code (keep):** everything under
`frontend/src/pages/CodingPage/components/MeasureMode/` and the `ImagePanel` button.

## 12.8 References

- **Design log (full history & rationale):** `docs/in-image-metrology.md`, and
  `temp/IN_IMAGE_METROLOGY_FEATURE.md` for the day-by-day decision trail
- **Core math:** `frontend/src/pages/CodingPage/components/MeasureMode/measureMath.ts`
- **UI:** `frontend/src/pages/CodingPage/components/MeasureMode/MeasureModal.tsx`
- **Frontend v2 conventions:** [§11 UI Design Principles](ui-design-principles.md) and the root
  `frontend/CLAUDE.md`
- **Path segmentation model (for the path-edge roll work):**
  `backend/models/path_segmentation_6July.pt`
