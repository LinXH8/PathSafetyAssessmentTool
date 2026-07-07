# Curvature Calculation Diagnostics

**Purpose**: Provide detailed, step-by-step explanation of curvature calculations to help users understand why a sharp turn was detected.

---

## Overview

When a segment has a sharp turn (curvature = 1), the system now provides comprehensive diagnostics showing:
- **Calculation steps** with formulas and values
- **All triplets analyzed** with their individual radii
- **The sharpest triplet** that triggered the sharp turn classification
- **Visual explanation** of the geometry

---

## Diagnostic Data Structure

### Response with Diagnostics

When calling `/api/projects/<project>/curvature/visualize`, the response now includes a `diagnostics` field:

```json
{
  "ok": true,
  "point": {"lon": 103.8198, "lat": 1.3521},
  "radius": 8.3,
  "width": 2.5,
  "curvature": 1,
  "circle_geojson": {...},
  "paths": [...],
  "layer_used": "cycling",
  "analysis_window_m": 5.0,
  "diagnostics": {
    "min_radius": 8.3,
    "total_triplets_checked": 10,
    "valid_triplets": 8,
    "skipped_triplets": 2,
    "min_triplet": {
      "index": 3,
      "points": [[x1, y1], [x2, y2], [x3, y3]],
      "sides": {
        "a": 1.2,
        "b": 1.5,
        "c": 2.1
      },
      "semi_perimeter": 2.4,
      "area": 0.85,
      "radius": 8.3,
      "is_minimum": true
    },
    "calculation_steps": {
      "step_1": {...},
      "step_2": {...},
      "step_3": {...},
      "step_4": {...},
      "conclusion": {...}
    },
    "all_triplets": [...]
  }
}
```

---

## Calculation Steps Format

The `calculation_steps` object provides a detailed breakdown:

```json
{
  "step_1": {
    "description": "Measure triangle sides",
    "formula": "a = distance(A, B), b = distance(B, C), c = distance(A, C)",
    "values": {
      "side_a": "1.20 meters",
      "side_b": "1.50 meters",
      "side_c": "2.10 meters"
    }
  },
  "step_2": {
    "description": "Calculate semi-perimeter",
    "formula": "p = (a + b + c) / 2",
    "calculation": "(1.20 + 1.50 + 2.10) / 2",
    "result": "2.40 meters"
  },
  "step_3": {
    "description": "Calculate triangle area using Heron's formula",
    "formula": "area = √(p × (p-a) × (p-b) × (p-c))",
    "calculation": "√(2.40 × 1.20 × 0.90 × 0.30)",
    "result": "0.85 square meters"
  },
  "step_4": {
    "description": "Calculate circumradius",
    "formula": "R = (a × b × c) / (4 × area)",
    "calculation": "(1.20 × 1.50 × 2.10) / (4 × 0.85)",
    "result": "8.30 meters"
  },
  "conclusion": {
    "description": "Compare with threshold",
    "threshold": "10.0 meters",
    "result": "8.30 meters",
    "classification": "Sharp Turn (< 10m)"
  }
}
```

---

## Frontend Dropdown Component

### Example: React Component

```tsx
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface DiagnosticsProps {
  diagnostics: {
    min_radius: number;
    total_triplets_checked: number;
    valid_triplets: number;
    skipped_triplets: number;
    calculation_steps: {
      step_1: any;
      step_2: any;
      step_3: any;
      step_4: any;
      conclusion: any;
    };
  };
  curvature: number;
}

export function CurvatureDiagnostics({ diagnostics, curvature }: DiagnosticsProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Only show diagnostics for sharp turns
  if (curvature !== 1 || !diagnostics) {
    return null;
  }

  const { calculation_steps } = diagnostics;

  return (
    <div className="curvature-diagnostics">
      {/* Header - Always Visible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="diagnostic-header"
      >
        <div className="header-content">
          <div className="warning-badge">
            ⚠️ Sharp Turn Detected
          </div>
          <div className="radius-value">
            Radius: {diagnostics.min_radius.toFixed(1)}m (Threshold: 10m)
          </div>
        </div>
        {isOpen ? <ChevronUp /> : <ChevronDown />}
      </button>

      {/* Dropdown Content */}
      {isOpen && (
        <div className="diagnostic-content">
          <div className="summary">
            <h4>Analysis Summary</h4>
            <ul>
              <li>Total points analyzed: {diagnostics.total_triplets_checked + 2}</li>
              <li>Triplets checked: {diagnostics.total_triplets_checked}</li>
              <li>Valid triplets: {diagnostics.valid_triplets}</li>
              <li>Sharpest radius found: <strong>{diagnostics.min_radius.toFixed(1)}m</strong></li>
            </ul>
          </div>

          <div className="calculation-explanation">
            <h4>How the Curvature Was Calculated</h4>
            <p className="explanation-intro">
              We analyze the path by sliding a 3-point window along the centerline.
              For each set of 3 consecutive points, we calculate the radius of the circle
              that passes through all three points (circumcircle). The smallest radius
              indicates the sharpest turn.
            </p>

            {/* Step 1: Measure Sides */}
            <div className="calc-step">
              <div className="step-number">Step 1</div>
              <div className="step-content">
                <h5>{calculation_steps.step_1.description}</h5>
                <div className="formula">{calculation_steps.step_1.formula}</div>
                <div className="values">
                  <div className="value-item">
                    <span className="label">Side a:</span>
                    <span className="value">{calculation_steps.step_1.values.side_a}</span>
                  </div>
                  <div className="value-item">
                    <span className="label">Side b:</span>
                    <span className="value">{calculation_steps.step_1.values.side_b}</span>
                  </div>
                  <div className="value-item">
                    <span className="label">Side c:</span>
                    <span className="value">{calculation_steps.step_1.values.side_c}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Semi-perimeter */}
            <div className="calc-step">
              <div className="step-number">Step 2</div>
              <div className="step-content">
                <h5>{calculation_steps.step_2.description}</h5>
                <div className="formula">{calculation_steps.step_2.formula}</div>
                <div className="calculation">{calculation_steps.step_2.calculation}</div>
                <div className="result">= {calculation_steps.step_2.result}</div>
              </div>
            </div>

            {/* Step 3: Triangle Area */}
            <div className="calc-step">
              <div className="step-number">Step 3</div>
              <div className="step-content">
                <h5>{calculation_steps.step_3.description}</h5>
                <div className="formula">{calculation_steps.step_3.formula}</div>
                <div className="calculation">{calculation_steps.step_3.calculation}</div>
                <div className="result">= {calculation_steps.step_3.result}</div>
              </div>
            </div>

            {/* Step 4: Circumradius */}
            <div className="calc-step">
              <div className="step-number">Step 4</div>
              <div className="step-content">
                <h5>{calculation_steps.step_4.description}</h5>
                <div className="formula">{calculation_steps.step_4.formula}</div>
                <div className="calculation">{calculation_steps.step_4.calculation}</div>
                <div className="result">= {calculation_steps.step_4.result}</div>
              </div>
            </div>

            {/* Conclusion */}
            <div className="conclusion">
              <h5>Conclusion</h5>
              <div className="comparison">
                <div className="value-comparison">
                  <span className="calculated">Calculated radius: {calculation_steps.conclusion.result}</span>
                  <span className="operator">&lt;</span>
                  <span className="threshold">Threshold: {calculation_steps.conclusion.threshold}</span>
                </div>
                <div className="classification sharp-turn">
                  {calculation_steps.conclusion.classification}
                </div>
              </div>
              <p className="explanation">
                Since the calculated radius ({calculation_steps.conclusion.result}) is less than
                the threshold ({calculation_steps.conclusion.threshold}), this segment contains
                a sharp turn that requires cyclist attention.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## CSS Styling

```css
.curvature-diagnostics {
  margin-bottom: 1rem;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.diagnostic-header {
  width: 100%;
  padding: 1rem;
  background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
  border: none;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background 0.2s;
}

.diagnostic-header:hover {
  background: linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.warning-badge {
  font-size: 1rem;
  font-weight: 600;
  color: #856404;
}

.radius-value {
  font-size: 0.9rem;
  color: #666;
}

.diagnostic-content {
  padding: 1.5rem;
  background: #fafafa;
}

.summary {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: white;
  border-radius: 4px;
  border-left: 4px solid #ffc107;
}

.summary h4 {
  margin-top: 0;
  color: #333;
}

.summary ul {
  margin: 0.5rem 0 0 0;
  padding-left: 1.5rem;
}

.summary li {
  margin: 0.5rem 0;
  color: #666;
}

.calculation-explanation {
  background: white;
  padding: 1.5rem;
  border-radius: 4px;
}

.explanation-intro {
  margin: 1rem 0;
  padding: 1rem;
  background: #e3f2fd;
  border-left: 4px solid #2196f3;
  color: #1565c0;
  line-height: 1.6;
}

.calc-step {
  display: flex;
  gap: 1rem;
  margin: 1.5rem 0;
  padding: 1rem;
  background: #f5f5f5;
  border-radius: 4px;
}

.step-number {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  background: #4caf50;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

.step-content {
  flex: 1;
}

.step-content h5 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.formula {
  font-family: 'Courier New', monospace;
  background: white;
  padding: 0.5rem;
  border-radius: 4px;
  margin: 0.5rem 0;
  color: #d32f2f;
}

.calculation {
  font-family: 'Courier New', monospace;
  color: #666;
  margin: 0.5rem 0;
}

.result {
  font-weight: bold;
  color: #1976d2;
  margin: 0.5rem 0;
}

.values {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.value-item {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem;
  background: white;
  border-radius: 4px;
}

.value-item .label {
  color: #666;
}

.value-item .value {
  font-weight: 600;
  color: #333;
}

.conclusion {
  margin-top: 2rem;
  padding: 1.5rem;
  background: #fff3cd;
  border: 2px solid #ffc107;
  border-radius: 4px;
}

.conclusion h5 {
  margin-top: 0;
  color: #856404;
}

.comparison {
  margin: 1rem 0;
}

.value-comparison {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 1.1rem;
  margin-bottom: 1rem;
}

.calculated {
  color: #d32f2f;
  font-weight: 600;
}

.operator {
  font-size: 1.5rem;
  color: #666;
}

.threshold {
  color: #4caf50;
  font-weight: 600;
}

.classification {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-weight: 600;
  margin: 1rem 0;
}

.classification.sharp-turn {
  background: #f44336;
  color: white;
}

.explanation {
  margin: 1rem 0 0 0;
  line-height: 1.6;
  color: #666;
}
```

---

## Alternative: Simpler Version

For a more compact display:

```tsx
export function SimpleDiagnostics({ diagnostics, curvature }: DiagnosticsProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (curvature !== 1 || !diagnostics) return null;

  return (
    <div className="simple-diagnostics">
      <button onClick={() => setIsOpen(!isOpen)} className="toggle-btn">
        ⚠️ Sharp Turn: {diagnostics.min_radius.toFixed(1)}m
        {isOpen ? ' ▼' : ' ▶'}
      </button>

      {isOpen && (
        <div className="details">
          <p><strong>Why is this a sharp turn?</strong></p>
          <p>
            The tightest curve on this path has a radius of only{' '}
            <strong>{diagnostics.min_radius.toFixed(1)} meters</strong>,
            which is less than our threshold of 10 meters.
          </p>
          <p>
            We analyzed {diagnostics.total_triplets_checked} sections of the path
            and found {diagnostics.valid_triplets} valid curves. The sharpest one
            requires cyclists to navigate a turn with a {diagnostics.min_radius.toFixed(1)}m
            radius, similar to a hairpin turn.
          </p>

          <details>
            <summary>View detailed calculation</summary>
            <pre>{JSON.stringify(diagnostics.calculation_steps, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
```

---

## Integration in Coding Page

### Placement

The diagnostics dropdown should appear:
1. **Above the map** - Most visible
2. **Below attribute row** - Contextual
3. **In a side panel** - Detailed view

### Recommended Layout

```tsx
function AttributesCodingPage() {
  const [vizData, setVizData] = useState(null);

  return (
    <div className="coding-page">
      <AttributesTable onRowClick={fetchVisualization} />

      {vizData && (
        <div className="visualization-section">
          {/* Diagnostics above map */}
          <CurvatureDiagnostics
            diagnostics={vizData.diagnostics}
            curvature={vizData.curvature}
          />

          {/* Map below diagnostics */}
          <CurvatureMap vizData={vizData} />
        </div>
      )}
    </div>
  );
}
```

---

## Diagnostic States

### 1. Sharp Turn Detected (curvature = 1)
```
⚠️ Sharp Turn Detected
Radius: 8.3m (Threshold: 10m)
[Click to expand calculation details]
```

### 2. No Sharp Turn (curvature = 2)
```
✓ No Sharp Turn
Radius: 15.7m (Threshold: 10m)
[No diagnostic dropdown needed]
```

### 3. No Data Available
```
ℹ️ No Path Data
Unable to calculate curvature - no path centerline found within 5m
```

---

## User Benefits

1. **Transparency**: Users understand exactly how the system made its decision
2. **Education**: Learn about geometric curve analysis
3. **Verification**: Can verify the calculation is correct
4. **Trust**: Builds confidence in automated coding
5. **Debugging**: Helps identify if there are data quality issues

---

## Summary

✅ **Detailed diagnostics added** to curvature visualization
✅ **Step-by-step calculations** with formulas and values
✅ **Frontend component examples** provided
✅ **Multiple display options** (detailed vs. simple)
✅ **Clear visual hierarchy** for easy understanding

The diagnostics provide complete transparency into the curvature calculation process, helping users understand why a sharp turn was detected! 🎯
