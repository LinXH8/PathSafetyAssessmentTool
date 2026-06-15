import { useMemo, useEffect, useState, useCallback } from "react";
import type { AttributeRow } from "../../../api";
import { GROUP_ORDER, GROUP_RULES, KEY_ALIASES } from "../../../constants/autocodeAttributes";
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
};

export default function AutocodeValidation({
  projectName,
  attributes,
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
