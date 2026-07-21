# 7. In-Image Path Measurement

The **Measure** tool lets you measure real-world distances directly on a segment's street-level
survey photo — for example, how many metres of clear width sit beside a path before hitting a
tree, drain, railing, or kerb. Use it to judge whether a path can be widened or have a cycling lane
added, based on the actual physical obstructions in the photo, rather than relying only on the
top-down GIS width layers (which do not capture on-the-ground obstructions and are sometimes
wrong).

---

## Table of Contents

- [7.1 Opening the Measure Tool](#71-opening-the-measure-tool)
- [7.2 Measuring Against a Known Object (Anchor)](#72-measuring-against-a-known-object-anchor)
- [7.3 Reading Off a Measurement (Ruler)](#73-reading-off-a-measurement-ruler)
- [7.4 Frames Without a Drain (Manual Dials)](#74-frames-without-a-drain-manual-dials)
- [7.5 Accuracy & Honest Limits](#75-accuracy-honest-limits)

---

## 7.1 Opening the Measure Tool

On the Coding page, open the street-view image panel for the segment you want to measure and click
the **📐 Measure** button in its header. A full-screen measurement window opens for that segment.
The button is disabled when the segment has no image.

Measurements are read off live on screen — they are **not** currently saved back to the segment.

## 7.2 Measuring Against a Known Object (Anchor)

The reliable way to measure is to anchor the tool on an object of known size that appears in the
photo:

1. **Pick the anchor type:**
   - **Drain** — choose from a dropdown of standard grating sizes. The default is the standard
     700 × 850 mm drain grating, with the 700 mm edge facing you, as typically seen on path drains.
   - **Tactile** — the yellow tactile tiles found at every crossing, 300 × 300 mm per tile, with
     whole-mat options (600 × 600, 900 × 900, …). Outline a full mat when visible — a bigger anchor
     gives a more accurate result.
   - **Custom** — enter any known flat rectangle's size in millimetres (near edge × side edge), for
     example ground signage. The object must lie flat on the ground.
2. **Click the object's four outline corners in order:** near-left → near-right → far-right →
   far-left ("near" means the edge closest to the camera). The panel keeps this order visible and a
   status line counts each corner as you click.
3. Once all four corners are clicked, the grid snaps into place with an **exact** solution and the
   tool switches straight to the Ruler.

## 7.3 Reading Off a Measurement (Ruler)

After anchoring, use the **Ruler**: click the path edge you're widening from, then click the
obstacle. The tool reads out the **clear width** between the two points.

A 1 m × 1 m grid is painted over the photo as a visual reference for square-counting, and it
extends back toward the camera when the anchor sits further out.

**A few things worth knowing while measuring:**
- Every measurement shows a **± uncertainty band**, never a bare number — this is deliberate. The
  tool is planning-grade, not survey-grade.
- Measurements are most reliable in the **near field (roughly 0–3 m in front of the camera)**.
  Beyond ~3 m the overlay is de-emphasised and a warning appears — treat far readings as soft.
- **Yaw** spins the grid to run down the path (a bike doesn't always point straight down it). Yaw
  only rotates the grid — it never changes a measured distance.

## 7.4 Frames Without a Drain (Manual Dials)

If a frame has no drain or other known object to anchor on, use the manual dials (Yaw, k1, Pitch,
Height, Roll) to line the grid up by eye. This is the fallback path, not the main one, and is less
accurate than anchoring — see the limits below.

## 7.5 Accuracy & Honest Limits

The Measure tool is intended for **planning-grade** decisions, not survey-grade certainty:

- **Typical accuracy is about ±0.4–0.5 m in the near field.** This is capped by the source imagery
  itself (640×457 px, no higher resolution available), not by the measuring method.
- **Anchored (drain) measurements are the accurate ones.** During calibration, the anchor method
  measured gratings it hadn't seen before to a median error of about 91 mm. Manual-dial
  measurements are looser.
- **Trust the near field.** Precision falls off quickly toward the horizon as pixels compress in
  the photo — stay within roughly 0–3 m, and treat readings beyond that as a rough guide only.
- **The tool assumes flat ground.** Slopes, camber, and measuring across a kerb onto a raised verge
  will make the reading less reliable.
- **If the tool and the GIS width layers disagree, that's expected — not a bug.** The tool exists
  specifically because the top-down GIS layers can be wrong about physical obstructions on the
  ground. When in doubt, validate against a tape measurement on site rather than against GIS.
