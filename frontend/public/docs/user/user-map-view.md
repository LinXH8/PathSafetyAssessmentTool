## 3. Map View & Analysis

Map views appear in several PSAT workflows, especially Coding, Path Analysis, Treatment, and GIS Layers.

---

## Table of Contents

- [3.1 Segment Map in Coding](#31-segment-map-in-coding)
- [3.2 Risk Colour Bands](#32-risk-colour-bands)
- [3.3 GIS Context](#33-gis-context)
- [3.4 GIS Layers Page](#34-gis-layers-page)

---

### 3.1 Segment Map in Coding

On the Coding page, the map helps you:

- click a segment to select it
- see risk-band colouring for saved scoring results
- view nearby GIS context for the current point
- inspect the spatial position of the current segment

### 3.2 Risk Colour Bands

Segments are colour-coded by their **highest relevant risk band** so you can quickly spot high-risk areas.

PSAT calculates four independent risk scores per segment:

| Score | Crash Type |
|---|---|
| **BB** | Bicyclist–Bicyclist |
| **BP** | Bicyclist–Pedestrian |
| **SB** | Single Bicyclist (departure/fall) |
| **VB** | Vehicle–Bicyclist |

#### Risk Bands for BB, BP, SB

| Band | Label | Score Range | Map Colour | Hex |
|---|---|---|---|---|
| 1 | Low | < 5 | 🟢 Green | `#87C424` |
| 2 | Medium | 5 – 10 | 🟡 Yellow | `#FFCC1A` |
| 3 | High | 10 – 20 | 🟠 Orange | `#FF5B1A` |
| 4 | Extreme | > 20 | 🟣 Purple | `#CD1AFF` |

#### Risk Bands for VB (Vehicle–Bicyclist)

| Band | Label | Score Range | Map Colour | Hex |
|---|---|---|---|---|
| 1 | Low | < 10 | 🟢 Green | `#87C424` |
| 2 | Medium | 10 – 25 | 🟡 Yellow | `#FFCC1A` |
| 3 | High | 25 – 60 | 🟠 Orange | `#FF5B1A` |
| 4 | Extreme | > 60 | 🟣 Purple | `#CD1AFF` |

> **Overall Risk Level Band** = the **highest** band across BB, BP, SB, and VB for that segment. A single Extreme sub-score makes the overall band Extreme regardless of the others.

### 3.3 GIS Context

Depending on the page and workflow, PSAT can show nearby GIS information within a **5 m radius** of the current segment, such as:

- cycling paths, shared paths, and footpaths
- road crossings and zebra crossings
- bus stops and MRT-related features
- road-name and planning-area context
- width, curvature, and gradient analysis overlays

### 3.4 GIS Layers Page

Use the dedicated **GIS Layers** page (accessible from the sidebar) when you want to inspect the raw shapefile layers themselves rather than just the map context around a segment.

That page lets you preview available layers, review their metadata, and add or replace GIS files when needed.
