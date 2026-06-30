import { useMemo, useEffect, useState, useCallback } from "react";
import type { AttributeRow } from "../../../api";
import { GROUP_ORDER, GROUP_RULES, KEY_ALIASES, V2_GROUP_TAB_LABELS } from "../../../constants/autocodeAttributes";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import "./AutocodeValidation.css";

function getValidationColor(pct: number): string {
  if (pct >= 90) return '#87C424';
  if (pct >= 85) return '#FFCC1A';
  if (pct >= 80) return '#FF5B1A';
  if (pct >= 75) return '#c11e38';
  return '#CD1AFF';
}

function getValidationTextColor(pct: number): string {
  if (pct >= 85 && pct < 90) return '#000';
  return '#fff';
}

type ValidationStats = {
  displayName: string;
  realKey: string;
  totalCount: number;
  unchangedCount: number;
  changedCount: number;
  correctnessPercentage: number;
};

type Props = {
  projectName: string;
  attributes: AttributeRow[];
  panelHeight?: number;
  /** "v1" (default) = current CSS layout; "v2" = Home.dc.html FRAME 4 "Automation Retention Rate" card. */
  variant?: "v1" | "v2";
};

export default function AutocodeValidation({
  projectName,
  attributes,
  variant = "v1",
}: Props) {
  const [validationStats, setValidationStats] = useState<Record<string, ValidationStats[]>>({});
  const [baselineRows, setBaselineRows] = useState<AttributeRow[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof GROUP_ORDER)[number]>("Facility configuration");

  // Normalize attribute values to consistent types (convert numeric strings to numbers)
  const normalizeAttributeValues = (attrs: AttributeRow[]): AttributeRow[] => {
    return attrs.map(row => {
      const normalized: AttributeRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined) {
          normalized[key] = value;
        } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
          // Convert numeric strings to numbers
          normalized[key] = Number(value);
        } else {
          normalized[key] = value;
        }
      }
      return normalized;
    });
  };

  // Helper function to fetch baseline (extracted so it can be called from multiple places)
  const fetchBaseline = useCallback(async () => {
    if (!projectName) {
      setBaselineRows([]);
      return;
    }

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/baseline`);
      if (!response.ok) {
        setBaselineRows([]);
        return;
      }
      const data = await response.json();
      const rows = data.rows || [];
      setBaselineRows(rows);

      // If no baseline exists, create it from current attributes (version 0)
      if (rows.length === 0 && attributes && attributes.length > 0) {
        try {
          const normalized = normalizeAttributeValues(attributes);
          await fetch(`/api/projects/${encodeURIComponent(projectName)}/baseline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: normalized })
          });
          setBaselineRows(normalized);
        } catch {
        }
      }
    } catch {
      setBaselineRows([]);
    }
  }, [projectName, attributes]);

  // Fetch and cache baseline from server on project load (separate from stats calculation)
  useEffect(() => {
    if (!projectName) {
      setBaselineRows([]);
      return;
    }

    let cancelled = false;

    fetchBaseline().then(() => {
      if (!cancelled) {
        // Baseline fetched successfully
      }
    });

    return () => { cancelled = true; };
  }, [projectName, attributes.length, fetchBaseline]); // Re-fetch if project changes or attributes length changes

  // Calculate validation statistics (uses cached baseline)
  useEffect(() => {
    if (!attributes || attributes.length === 0) {
      setValidationStats({});
      return;
    }

    const newStats: Record<string, ValidationStats[]> = {};

    // Use cached baseline, or attributes if no baseline exists
    const valuesToCompare = baselineRows.length > 0 ? baselineRows : attributes;

    // Calculate stats for each attribute group
    for (const group of GROUP_ORDER) {
      const fieldList = GROUP_RULES[group];
      if (!fieldList) continue;

      const groupStats: ValidationStats[] = [];

      for (const displayName of fieldList) {
        const realKey = KEY_ALIASES[displayName] ?? displayName;

        // Count unchanged vs changed values
        let unchangedCount = 0;
        let changedCount = 0;

        for (let i = 0; i < attributes.length; i++) {
          const currentValue = attributes[i]?.[realKey];
          const originalValue = valuesToCompare[i]?.[realKey];

          // Determine if value has changed from original
          let isChanged = true;

          // Handle null/undefined as equivalent
          if ((currentValue === null || currentValue === undefined) &&
            (originalValue === null || originalValue === undefined)) {
            isChanged = false;
          }
          // Strict comparison first (same type, same value)
          else if (currentValue === originalValue) {
            isChanged = false;
          }
          // Type-aware comparison for numeric values
          else if (typeof currentValue === 'number' && typeof originalValue === 'string') {
            const parsedOriginal = Number(originalValue);
            if (!Number.isNaN(parsedOriginal) && currentValue === parsedOriginal) {
              isChanged = false;
            }
          }
          else if (typeof currentValue === 'string' && typeof originalValue === 'number') {
            const parsedCurrent = Number(currentValue);
            if (!Number.isNaN(parsedCurrent) && parsedCurrent === originalValue) {
              isChanged = false;
            }
          }

          if (isChanged) {
            changedCount++;
          } else {
            unchangedCount++;
          }
        }

        const totalCount = attributes.length;
        const correctnessPercentage = totalCount > 0 ? (unchangedCount / totalCount) * 100 : 0;

        groupStats.push({
          displayName,
          realKey,
          totalCount,
          unchangedCount,
          changedCount,
          correctnessPercentage,
        });
      }

      newStats[group] = groupStats;
    }

    setValidationStats(newStats);
  }, [attributes, baselineRows]); // Recalculate whenever attributes OR baseline changes

  // Listen for baseline updates from autocode operations
  useEffect(() => {
    const handleBaselineUpdate = () => {
      // Refetch baseline when it's updated by autocode
      fetchBaseline();
    };

    window.addEventListener("psat:baseline:updated", handleBaselineUpdate);

    return () => {
      window.removeEventListener("psat:baseline:updated", handleBaselineUpdate);
    };
  }, [fetchBaseline]);

  const groupsWithFields = useMemo(() => {
    return GROUP_ORDER.filter(g => (validationStats[g] ?? []).length > 0);
  }, [validationStats]);

  // Set activeTab to first group when it changes
  useEffect(() => {
    if (groupsWithFields.length > 0 && !groupsWithFields.includes(activeTab)) {
      setActiveTab(groupsWithFields[0]);
    }
  }, [groupsWithFields, activeTab]);

  // ── v2 render — Home.dc.html FRAME 4 "Automation Retention Rate" card.
  // Reuses validationStats/groupsWithFields/activeTab; presentation per
  // DESIGN_GUIDE (card §2, tabs §6, validation chips §10). ──
  if (variant === "v2") {
    const v2Stats = validationStats[activeTab] ?? [];
    const card2 = { background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: 6 };
    const v2Legend: Array<[string, string]> = [["≥90%", "#87C424"], ["85-89%", "#FFCC1A"], ["80-84%", "#FF5B1A"], ["<79%", "#CD1AFF"]];
    return (
      <div style={{ ...card2, display: "flex", flexDirection: "column", gap: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text }}>Automation Retention Rate</span>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {v2Legend.map(([label, color]) => (
              <span key={label} style={{ display: "flex", gap: 4, alignItems: "center", fontFamily: FONT, fontSize: 12, color: COLOR.gray600 }}>
                <span style={{ width: 9, height: 9, background: color, borderRadius: 2, display: "inline-block", flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>
        </div>
        {(!attributes || attributes.length === 0) ? (
          <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500, padding: 8 }}>No data available.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", overflowX: "auto", scrollbarWidth: "none" }}>
              {groupsWithFields.map((group) => {
                const active = activeTab === group;
                return (
                  <div
                    key={group}
                    onClick={() => setActiveTab(group)}
                    style={{ padding: "8px 13px", lineHeight: 1, boxSizing: "border-box", fontFamily: FONT, fontWeight: 700, fontSize: 16, cursor: "pointer", whiteSpace: "nowrap", borderRadius: "6px 6px 0 0", border: `1px solid ${COLOR.border}`, borderBottom: active ? "none" : `1px solid ${COLOR.border}`, marginBottom: active ? -1 : 0, background: active ? COLOR.white : COLOR.gray100, color: active ? COLOR.text : COLOR.gray500 }}
                  >
                    {V2_GROUP_TAB_LABELS[group] ?? group}
                  </div>
                );
              })}
            </div>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: "0 6px 6px 6px", padding: 14, marginTop: -1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
                {v2Stats.map((stat) => {
                  const chipColor = getValidationColor(stat.correctnessPercentage);
                  const chipText = getValidationTextColor(stat.correctnessPercentage);
                  return (
                    <div key={stat.realKey} style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: FONT, fontSize: 16, color: COLOR.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stat.displayName}</div>
                        <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>{stat.changedCount}/{stat.totalCount} changed</div>
                      </div>
                      <div style={{ background: chipColor, color: chipText, fontFamily: FONT, fontWeight: 700, fontSize: 16, borderRadius: 6, padding: "4px 10px", flexShrink: 0 }}>
                        {Math.round(stat.correctnessPercentage)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!attributes || attributes.length === 0) {
    return (
      <div className="autocode-validation-panel">
        <div className="autocode-panel-header" onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
              Autocode Validation {isExpanded ? '▼' : '▶'}
            </h3>
          </div>
        </div>
        {isExpanded && (
          <div className="autocode-panel-content">
            <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>No data available.</p>
          </div>
        )}
      </div>
    );
  }

  const currentStats = validationStats[activeTab] ?? [];

  return (
    <div className="autocode-validation-panel">
      {/* Header */}
      <div className="autocode-panel-header" onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
            Autocode Validation {isExpanded ? '▼' : '▶'}
          </h3>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="autocode-panel-content">
          {/* Tab Buttons */}
          <div className="autocode-tabs">
            {groupsWithFields.map((group) => (
              <button
                key={group}
                className={`autocode-tab-button ${activeTab === group ? 'active' : ''}`}
                onClick={() => setActiveTab(group)}
              >
                {group}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="autocode-tab-content">
            <div className="autocode-grid">
              {currentStats.map((stat) => {
                const badgeColor = getValidationColor(stat.correctnessPercentage);
                const textColor = getValidationTextColor(stat.correctnessPercentage);

                return (
                  <div key={stat.realKey} className="autocode-card">
                    <div className="autocode-card-title">{stat.displayName}</div>

                    <div className="autocode-card-stats">
                      <div className="autocode-badge" style={{ backgroundColor: badgeColor, color: textColor }}>
                        {Math.round(stat.correctnessPercentage)}%
                      </div>
                      <div className="autocode-changed">
                        {stat.changedCount}/{stat.totalCount} changed
                      </div>
                    </div>

                    <div className="autocode-progress-bar">
                      <div
                        className="autocode-progress-fill"
                        style={{ width: `${stat.correctnessPercentage}%`, backgroundColor: badgeColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* AL Grade Legend */}
            <div className="al-legend">
              <div className="al-legend-title">Automation Retention Rate:</div>
              {[
                { range: '≥90%', pct: 95 },
                { range: '85–89%', pct: 87 },
                { range: '80–84%', pct: 82 },
                { range: '75–79%', pct: 77 },
                { range: '<75%', pct: 55 },
              ].map(({ range, pct }) => (
                <div key={range} className="al-legend-item">
                  <div 
                    className="al-legend-color" 
                    style={{ backgroundColor: getValidationColor(pct) }}
                  />
                  <span className="al-legend-range">{range}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
