# Curvature Diagnostics - Visual Example

## What the User Sees

### **Collapsed State** (Default)

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Sharp Turn Detected                                      │
│  Radius: 8.3m (Threshold: 10m)                          [▼] │
└─────────────────────────────────────────────────────────────┘
```

The yellow/orange background immediately draws attention when a sharp turn is detected.

---

### **Expanded State** (User clicks dropdown)

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Sharp Turn Detected                                      │
│  Radius: 8.3m (Threshold: 10m)                          [▲] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 Analysis Summary                                         │
│  • Total points analyzed: 12                                │
│  • Triplets checked: 10                                     │
│  • Valid triplets: 8                                        │
│  • Sharpest radius found: 8.3m                              │
│                                                              │
│  ──────────────────────────────────────────────────────────│
│                                                              │
│  How the Curvature Was Calculated                           │
│                                                              │
│  ℹ️ We analyze the path by sliding a 3-point window along  │
│     the centerline. For each set of 3 consecutive points,  │
│     we calculate the radius of the circle that passes      │
│     through all three points (circumcircle). The smallest  │
│     radius indicates the sharpest turn.                    │
│                                                              │
│  ──────────────────────────────────────────────────────────│
│                                                              │
│  ① Step 1: Measure triangle sides                           │
│     Formula: a = distance(A, B), b = distance(B, C), ...   │
│                                                              │
│     Side a: 1.20 meters                                     │
│     Side b: 1.50 meters                                     │
│     Side c: 2.10 meters                                     │
│                                                              │
│  ② Step 2: Calculate semi-perimeter                         │
│     Formula: p = (a + b + c) / 2                           │
│     Calculation: (1.20 + 1.50 + 2.10) / 2                  │
│     = 2.40 meters                                           │
│                                                              │
│  ③ Step 3: Calculate triangle area using Heron's formula   │
│     Formula: area = √(p × (p-a) × (p-b) × (p-c))          │
│     Calculation: √(2.40 × 1.20 × 0.90 × 0.30)             │
│     = 0.85 square meters                                    │
│                                                              │
│  ④ Step 4: Calculate circumradius                           │
│     Formula: R = (a × b × c) / (4 × area)                  │
│     Calculation: (1.20 × 1.50 × 2.10) / (4 × 0.85)        │
│     = 8.30 meters                                           │
│                                                              │
│  ──────────────────────────────────────────────────────────│
│                                                              │
│  📌 Conclusion                                               │
│                                                              │
│     Calculated radius:  8.30 meters                         │
│               <                                              │
│     Threshold:         10.0 meters                          │
│                                                              │
│     🚨 Sharp Turn (< 10m)                                   │
│                                                              │
│     Since the calculated radius (8.30 meters) is less than │
│     the threshold (10.0 meters), this segment contains a   │
│     sharp turn that requires cyclist attention.            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Actual Rendered Example (HTML)

Here's how it would actually look in the browser:

### Collapsed:

![Collapsed State](https://via.placeholder.com/600x60/fff3cd/856404?text=⚠️+Sharp+Turn+Detected+|+Radius:+8.3m+(Threshold:+10m)+▼)

### Expanded:

<details>
<summary><strong>⚠️ Sharp Turn Detected</strong> - Radius: 8.3m (Threshold: 10m)</summary>

#### 📊 Analysis Summary
- **Total points analyzed**: 12
- **Triplets checked**: 10
- **Valid triplets**: 8
- **Sharpest radius found**: **8.3m**

---

#### How the Curvature Was Calculated

> ℹ️ **Explanation**: We analyze the path by sliding a 3-point window along the centerline. For each set of 3 consecutive points, we calculate the radius of the circle that passes through all three points (circumcircle). The smallest radius indicates the sharpest turn.

---

#### ① Step 1: Measure triangle sides

**Formula**: `a = distance(A, B), b = distance(B, C), c = distance(A, C)`

| Side | Distance |
|------|----------|
| a | 1.20 meters |
| b | 1.50 meters |
| c | 2.10 meters |

---

#### ② Step 2: Calculate semi-perimeter

**Formula**: `p = (a + b + c) / 2`

**Calculation**: `(1.20 + 1.50 + 2.10) / 2`

**Result**: `2.40 meters`

---

#### ③ Step 3: Calculate triangle area using Heron's formula

**Formula**: `area = √(p × (p-a) × (p-b) × (p-c))`

**Calculation**: `√(2.40 × 1.20 × 0.90 × 0.30)`

**Result**: `0.85 square meters`

---

#### ④ Step 4: Calculate circumradius

**Formula**: `R = (a × b × c) / (4 × area)`

**Calculation**: `(1.20 × 1.50 × 2.10) / (4 × 0.85)`

**Result**: `8.30 meters`

---

#### 📌 Conclusion

```
Calculated radius:  8.30 meters
         <
Threshold:         10.0 meters

🚨 Sharp Turn (< 10m)
```

Since the calculated radius (8.30 meters) is less than the threshold (10.0 meters), this segment contains a sharp turn that requires cyclist attention.

</details>

---

## Color Scheme

| Element | Background | Text | Border |
|---------|-----------|------|--------|
| Collapsed Header | #fff3cd (light yellow) | #856404 (dark yellow) | #ffc107 (amber) |
| Expanded Content | #fafafa (light gray) | #333 (dark gray) | #e0e0e0 (gray) |
| Info Box | #e3f2fd (light blue) | #1565c0 (dark blue) | #2196f3 (blue) |
| Step Boxes | #f5f5f5 (very light gray) | #333 | none |
| Formula | white | #d32f2f (red) | none |
| Conclusion | #fff3cd (light yellow) | #856404 | #ffc107 (amber) |
| Sharp Turn Badge | #f44336 (red) | white | none |

---

## Interactive Behavior

### On Hover
- Header background darkens slightly
- Cursor changes to pointer
- Subtle shadow appears

### On Click
- Smooth expand/collapse animation (300ms)
- Arrow icon rotates
- Content fades in/out

### Accessibility
- Keyboard navigable (Tab, Enter, Space)
- Screen reader friendly with ARIA labels
- High contrast mode compatible

---

## Mobile Responsive

On smaller screens:

```
┌───────────────────────────────┐
│ ⚠️ Sharp Turn                 │
│ Radius: 8.3m < 10m        [▼]│
├───────────────────────────────┤
│ 📊 Summary                    │
│ • Points: 12                  │
│ • Triplets: 10                │
│ • Min radius: 8.3m            │
│                                │
│ Calculation (tap to expand):  │
│ [Show Details]                │
└───────────────────────────────┘
```

Steps are collapsed by default on mobile, with an accordion to expand each one individually.

---

## Copy-Paste Ready HTML/CSS

```html
<div class="curvature-diagnostics">
  <button class="diagnostic-header" onclick="toggleDiagnostics()">
    <div class="header-content">
      <span class="warning-badge">⚠️ Sharp Turn Detected</span>
      <span class="radius-value">Radius: 8.3m (Threshold: 10m)</span>
    </div>
    <span class="chevron">▼</span>
  </button>

  <div class="diagnostic-content" style="display: none;">
    <div class="summary-box">
      <h4>📊 Analysis Summary</h4>
      <ul>
        <li>Total points analyzed: <strong>12</strong></li>
        <li>Triplets checked: <strong>10</strong></li>
        <li>Valid triplets: <strong>8</strong></li>
        <li>Sharpest radius found: <strong>8.3m</strong></li>
      </ul>
    </div>

    <div class="explanation-box">
      <p>
        We analyze the path by sliding a 3-point window along the centerline.
        For each set of 3 consecutive points, we calculate the radius of the
        circle that passes through all three points (circumcircle). The
        smallest radius indicates the sharpest turn.
      </p>
    </div>

    <div class="calculation-steps">
      <!-- Steps 1-4 here -->
    </div>

    <div class="conclusion-box">
      <h4>📌 Conclusion</h4>
      <div class="comparison">
        <span class="value-calc">8.30 meters</span>
        <span class="operator">&lt;</span>
        <span class="value-threshold">10.0 meters</span>
      </div>
      <div class="result-badge sharp">🚨 Sharp Turn (&lt; 10m)</div>
      <p class="explanation">
        Since the calculated radius (8.30 meters) is less than the threshold
        (10.0 meters), this segment contains a sharp turn that requires
        cyclist attention.
      </p>
    </div>
  </div>
</div>

<script>
function toggleDiagnostics() {
  const content = document.querySelector('.diagnostic-content');
  const chevron = document.querySelector('.chevron');
  const isOpen = content.style.display !== 'none';

  content.style.display = isOpen ? 'none' : 'block';
  chevron.textContent = isOpen ? '▼' : '▲';
}
</script>
```

---

## User Flow

1. **User navigates to segment** with sharp turn
   - Dropdown appears above map with yellow warning background
   - Shows radius value immediately visible

2. **User clicks dropdown** to understand why
   - Smooth expansion reveals detailed breakdown
   - Sees summary statistics first

3. **User reads explanation**
   - Understands the triplet method concept
   - Sees visual representation of the calculation

4. **User reviews calculation**
   - Step-by-step formulas with actual values
   - Can verify the math if desired

5. **User reads conclusion**
   - Clear comparison: 8.3m < 10m
   - Understands the classification logic

6. **User closes dropdown** (optional)
   - Continues to next segment
   - Dropdown can stay open or closed as preferred

---

## Benefits

✅ **Educational** - Users learn how curvature is calculated
✅ **Transparent** - Complete visibility into the algorithm
✅ **Verifiable** - Can check the math manually if needed
✅ **Non-intrusive** - Collapsed by default, expandable on demand
✅ **Contextual** - Only shows for sharp turns (where it matters)
✅ **Professional** - Clean, modern UI design

This creates trust in the automated coding system! 🎯
