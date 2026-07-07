/**
 * reportSectionRenderers.tsx — per-domain render functions for report sections.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). These
 * are deliberately plain render *functions* (not components): converting them
 * to components would insert new React element-type boundaries into the tree,
 * and the report canvas must produce a byte-identical DOM for html2canvas PDF
 * capture. Container-owned callbacks/state arrive via a small context object
 * passed as the first argument.
 *
 * - `renderBandDonut` / `renderBandBadge` — pure risk-band chart/badge pieces.
 * - `renderTopRiskFullPage` / `renderTopRiskGrid` / `renderTopRiskTabular` —
 *   the three Top Risk Stretches view modes (`TopRiskRenderContext`).
 * - `renderTreatmentSummary` — the per-project treatments block
 *   (`TreatmentSummaryRenderContext`).
 *
 * Side effects: none (the upload button invokes a context callback).
 */
import { PieChart, Pie, Cell, Tooltip as RechartTooltip } from "recharts";
import { RISK_COLORS, RISK_LABELS } from "../../../utils/riskColors";
import {
  CRASH_TYPE_LABELS, PAGE_GAP, PAGE_H, TREATMENT_NAMES, tdStyle, thStyle,
} from "../reportBuilderConstants";
import type {
  BandDist, EnrichedDetail, ProjectTreatmentSummary, TopRiskRow,
} from "../reportBuilderTypes";
import { AttrTag, EditableText, SegmentImage, TreatmentBadge } from "./reportPrimitives";

/** Percentage label inside each donut slice (hidden below 3%). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts label props were `any` pre-extraction
const renderDonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.03) return null;
  return (
    <text x={x} y={y} fill="#111" textAnchor="middle" dominantBaseline="central" style={{ fontSize: "10px", fontWeight: 700 }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

/** A 140px risk-band donut + legend for one crash type's distribution. */
export const renderBandDonut = (dist: BandDist, total: number) => {
  if (total === 0) return <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: "20px 0" }}>No data</div>;

  const chartData = [1, 2, 3, 4].map((band) => ({
    name: RISK_LABELS[band],
    value: dist[band] || 0,
    color: RISK_COLORS[band],
    band
  })).filter(d => d.value > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>Total: {total} segments</div>
      <div style={{ width: 140, height: 140 }}>
        <PieChart width={140} height={140}>
          <Pie
            data={chartData}
            cx={70}
            cy={70}
            labelLine={false}
            label={renderDonutLabel}
            innerRadius={30}
            outerRadius={65}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <RechartTooltip contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }} itemStyle={{ fontSize: 10, color: "#222" }} />
        </PieChart>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 12px", marginTop: 8 }}>
        {chartData.map((item) => (
          <div key={item.band} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
            <div style={{ color: "#222", fontWeight: 700 }}>{item.name}: {item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** A coloured risk-band pill; `short` renders the 3-letter form. */
export const renderBandBadge = (band: number, short = false) => (
  <span style={{ display: "inline-block", padding: short ? "1px 4px" : "1px 6px", borderRadius: 3, fontSize: short ? 9 : 10, fontWeight: 600, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff" }}>
    {short ? (RISK_LABELS[band]?.slice(0, 3).toUpperCase() ?? "—") : (RISK_LABELS[band] ?? "—")}
  </span>
);

/** Container-owned state/callbacks the Top Risk renderers need. */
export interface TopRiskRenderContext {
  getEnriched: (row: TopRiskRow) => EnrichedDetail;
  getSegmentTreatments: (row: TopRiskRow) => number[];
  dispNameWithQuarter: (name: string) => string;
  handleUploadTreatmentImageClick: (project: string, segIndex: number) => void;
  secTitle: (id: string, defaultTitle: string) => string;
  setSecTitle: (id: string, title: string) => void;
}

// ── Top Risk renderers ────────────────────────────────────────────────────
export const renderTopRiskFullPage = (ctx: TopRiskRenderContext, rows: TopRiskRow[], elId: string) => {
  const { getEnriched, getSegmentTreatments, dispNameWithQuarter, handleUploadTreatmentImageClick, secTitle, setSecTitle } = ctx;
  return (
    <div style={{ flex: 1, overflow: "visible", display: "flex", flexDirection: "column" }}>
      {rows.map((row, i) => {
        const e = getEnriched(row);
        const t = getSegmentTreatments(row);
        const isFirst = i === 0;
        const isLast = i === rows.length - 1;

        // Each page must exactly equal PAGE_H (except possibly the last one)
        // so that the chunks break precisely on the PDF boundaries.
        const height = isLast ? "auto" : PAGE_H;

        return (
          <div key={i} style={{ height, boxSizing: "border-box", paddingBottom: isLast ? 0 : PAGE_GAP, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {isFirst ? (
              <div style={{ padding: "8px 12px 12px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <EditableText value={secTitle(elId, "Top Risk Stretches")} onChange={(val) => setSecTitle(elId, val)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
                    <div style={{ color: "#ddd", fontSize: 20 }}>|</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
                      {dispNameWithQuarter(row._project)} <span style={{ color: "#666", fontWeight: 400, fontSize: 18 }}>Segment {row._segIndex}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "10px 14px 12px", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>
                  {secTitle(elId, "Top Risk Stretches")} <span style={{ color: "#aaa", fontWeight: 500 }}>(#{i + 1})</span>
                </div>
                <div style={{ color: "#ddd", fontSize: 20 }}>|</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
                  {dispNameWithQuarter(row._project)} <span style={{ color: "#666", fontWeight: 400, fontSize: 18 }}>Segment {row._segIndex}</span>
                </div>
              </div>
            )}

            <div style={{ flex: 1, background: "#fff", border: `2px solid ${RISK_COLORS[row._maxBand] || "#ddd"}`, borderRadius: 8, margin: "0 14px", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
              {/* Top Row: Original */}
              <div style={{ flex: "1 1 50%", borderBottom: "1px solid #ddd", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {/* Image Section */}
                <div style={{ flex: 1, position: "relative", flexShrink: 1, minHeight: 0 }}>
                  <div style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 12px", borderRadius: 16, fontSize: 12, zIndex: 10 }}>Original</div>
                  <SegmentImage src={e.imageUrl} width="100%" height="100%" />
                  {/* Ranking Badge */}
                  <div style={{ position: "absolute", top: 16, left: 16, background: RISK_COLORS[row._maxBand] || "#333", color: "#fff", width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 10 }}>
                    {i + 1}
                  </div>
                </div>

                {/* Content Section */}
                <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
                    {/* Main Factors */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#a020d0", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>Top Contributing Attribute</div>
                      {e.topAttributes.length > 0 ? (
                        <div style={{ fontSize: 16, color: "#333", fontWeight: 500, display: "flex", alignItems: "center" }}>
                          <span style={{ marginRight: 8, color: "#cc2200" }}>⚠️</span>
                          {e.topAttributes[0].name}
                          <span style={{ marginLeft: 12, fontSize: 12, color: "#cc2200", fontWeight: 700, background: "#fdeded", padding: "2px 8px", borderRadius: 12 }}>+{e.topAttributes[0].multiplier.toFixed(1)}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, color: "#bbb", fontStyle: "italic" }}>No contributing factors identified</div>
                      )}

                      {e.topAttributes.length > 1 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Other significant factors:</div>
                          <ul style={{ margin: 0, paddingLeft: 18, color: "#555", fontSize: 12, lineHeight: 1.4 }}>
                            {e.topAttributes.slice(1).map((a, j) => (
                              <li key={j}>{a.name} <span style={{ color: "#cc2200", fontWeight: 600 }}>(+{a.multiplier.toFixed(1)})</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    {/* Header: Score */}
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: RISK_COLORS[row._maxBand] || "#222", lineHeight: 1 }}>{row._sumScore.toFixed(1)}</div>
                      </div>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Original Risk Score</div>
                    </div>
                  </div>

                  <div style={{ flex: 1, minHeight: 8 }} /> {/* Spacer */}

                  {/* Crash Type Scores */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: "#faf8fd", padding: "8px 12px", borderRadius: 8, border: "1px solid #ede8f5", flexShrink: 0 }}>
                    {(["VB", "BB", "SB", "BP"] as const).map((ct) => {
                      const band = row[`${ct} Band` as keyof TopRiskRow] as number;
                      const score = row[ct as keyof TopRiskRow] as number;
                      return (
                        <div key={ct} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#555", whiteSpace: "nowrap" }}>{CRASH_TYPE_LABELS[ct] || ct}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: RISK_COLORS[band] || "#333", minWidth: 32, textAlign: "right" }}>{score.toFixed(1)}</div>
                            <div style={{ padding: "2px 6px", borderRadius: 8, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", minWidth: 50, textAlign: "center", whiteSpace: "nowrap" }}>
                              {RISK_LABELS[band] || "None"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bottom Row: Post Treatment */}
              <div style={{ flex: "1 1 50%", display: "flex", flexDirection: "column", background: "#fcfcfc", overflow: "hidden" }}>
                {/* Image Section */}
                <div style={{ flex: 1, position: "relative", flexShrink: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f9f9f9" }}>
                  {e.postImageUrl ? (
                    <>
                      <div style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 12px", borderRadius: 16, fontSize: 12, zIndex: 10 }}>Post Treatment</div>
                      <SegmentImage src={e.postImageUrl} width="100%" height="100%" />
                      <button
                        data-html2canvas-ignore="true"
                        onClick={() => handleUploadTreatmentImageClick(row._project, row._segIndex)}
                        style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(160, 32, 208, 0.9)", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", zIndex: 10, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                      >
                        Change Image
                      </button>
                    </>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#888", gap: 12 }}>
                      <div style={{ fontSize: 14 }}>Post treatment photo missing</div>
                      <button data-html2canvas-ignore="true" onClick={() => handleUploadTreatmentImageClick(row._project, row._segIndex)} style={{ padding: "8px 16px", background: "#a020d0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                        Upload Treatment Image
                      </button>
                    </div>
                  )}
                </div>

                {/* Content Section */}
                <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
                    {/* Applied Treatments */}
                    <div style={{ flex: 1, background: "#f5fbf6", padding: "10px 14px", borderRadius: 8, border: "1px solid #c8e8d0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#27ae60", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>Applied Treatments</div>
                      {t.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 16, color: "#226633", fontSize: 11, lineHeight: 1.4 }}>
                          {t.map(id => <li key={id}>{TREATMENT_NAMES[id] ?? `Treatment ${id}`}</li>)}
                        </ul>
                      ) : (
                        <div style={{ fontSize: 11, color: "#88ca99", fontStyle: "italic" }}>No treatments applied</div>
                      )}
                    </div>
                    {/* Header: Score */}
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {t.length > 0 && e.postScores ? (
                          <div style={{ fontSize: 32, fontWeight: 800, color: RISK_COLORS[e.postScores.Overall_Band] || "#222", lineHeight: 1 }}>{e.postScores.Overall.toFixed(1)}</div>
                        ) : (
                          <div style={{ fontSize: 32, fontWeight: 800, color: "#ccc", lineHeight: 1 }}>—</div>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Post Treatment Score</div>
                    </div>
                  </div>

                  <div style={{ flex: 1, minHeight: 8 }} /> {/* Spacer */}

                  {/* Crash Type Scores */}
                  {t.length > 0 && e.postScores ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: "#faf8fd", padding: "8px 12px", borderRadius: 8, border: "1px solid #ede8f5", flexShrink: 0 }}>
                      {(["VB", "BB", "SB", "BP"] as const).map((ct) => {
                        const band = e.postScores![`${ct}_Band` as keyof typeof e.postScores] as number;
                        const score = e.postScores![ct as keyof typeof e.postScores] as number;
                        return (
                          <div key={ct} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#555", whiteSpace: "nowrap" }}>{CRASH_TYPE_LABELS[ct] || ct}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "center" }}>
                              <div style={{ fontSize: 18, fontWeight: 700, color: RISK_COLORS[band] || "#333", minWidth: 32, textAlign: "right" }}>{score.toFixed(1)}</div>
                              <div style={{ padding: "2px 6px", borderRadius: 8, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", minWidth: 50, textAlign: "center", whiteSpace: "nowrap" }}>
                                {RISK_LABELS[band] || "None"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#fcfcfc", padding: 16, borderRadius: 8, border: "1px dashed #e0e0e0", flexShrink: 0, height: 104 }}>
                      <div style={{ fontSize: 14, color: "#aaa" }}>No post-treatment scores available</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const renderTopRiskGrid = (ctx: TopRiskRenderContext, rows: TopRiskRow[]) => {
  const { getEnriched, getSegmentTreatments, dispNameWithQuarter } = ctx;
  return (
    <div style={{ flex: 1, overflow: "visible", padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignContent: "start" }}>
      {rows.map((row, i) => {
        const e = getEnriched(row); const t = getSegmentTreatments(row);
        return (
          <div key={i} style={{ border: `2px solid ${RISK_COLORS[row._maxBand] || "#ddd"}`, borderRadius: 6, background: "#fff", overflow: "hidden" }}>
            <SegmentImage src={e.imageUrl} width={999} height={85} />
            <div style={{ padding: "7px 9px" }}>
              <div style={{ fontSize: 9, color: "#bbb" }}>Rank #{i + 1}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispNameWithQuarter(row._project)}</div>
              <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Segment {row._segIndex}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#222" }}>{row._sumScore.toFixed(1)}</span>
                {renderBandBadge(row._maxBand)}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#888", letterSpacing: 0.3, marginBottom: 2 }}>CONTRIBUTING FACTORS</div>
              <div style={{ marginBottom: 5 }}>
                {e.topAttributes.length > 0 ? e.topAttributes.map((a, j) => <AttrTag key={j} {...a} />) : <span style={{ fontSize: 9, color: "#bbb" }}>—</span>}
              </div>
              <TreatmentBadge ids={t} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 4px", marginTop: 5 }}>
                {(["VB", "BB", "SB", "BP"] as const).map((ct) => (
                  <div key={ct} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 8, color: "#888", width: 16 }}>{ct}</span>
                    {renderBandBadge(row[`${ct} Band` as keyof TopRiskRow] as number, true)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const renderTopRiskTabular = (ctx: TopRiskRenderContext, rows: TopRiskRow[]) => {
  const { getEnriched, getSegmentTreatments, dispNameWithQuarter } = ctx;
  return (
    <div style={{ flex: 1, overflow: "visible" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "#f5f0fa", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ ...thStyle, width: 24 }}>#</th>
            <th style={{ ...thStyle, width: 60 }}>Image</th>
            <th style={{ ...thStyle, width: 110 }}>Project</th>
            <th style={{ ...thStyle, width: 32 }}>Seg</th>
            <th style={{ ...thStyle, width: 44 }}>Score</th>
            <th style={thStyle}>Top 5 Risk Factors (Before)</th>
            <th style={thStyle}>Applied Treatments (After)</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>VB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>BB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>SB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>BP</th>
            <th style={{ ...thStyle, width: 44, textAlign: "center" }}>Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const e = getEnriched(row); const t = getSegmentTreatments(row);
            return (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: "#888" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px" }}><SegmentImage src={e.imageUrl} width={55} height={38} /></td>
                <td style={{ ...tdStyle, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispNameWithQuarter(row._project)}</td>
                <td style={tdStyle}>{row._segIndex}</td>
                <td style={{ ...tdStyle, fontWeight: 700, fontSize: 12 }}>{row._sumScore.toFixed(1)}</td>
                <td style={{ ...tdStyle, maxWidth: 160 }}>
                  {e.topAttributes.length > 0 ? e.topAttributes.map((a, j) => <AttrTag key={j} {...a} />) : <span style={{ color: "#bbb" }}>—</span>}
                </td>
                <td style={{ ...tdStyle, maxWidth: 160 }}>
                  {t.length > 0
                    ? t.map((id) => <span key={id} style={{ fontSize: 9, color: "#226633", display: "block", lineHeight: 1.5 }}>✓ {id}. {TREATMENT_NAMES[id] ?? `Treatment ${id}`}</span>)
                    : <span style={{ color: "#ccc", fontSize: 9 }}>None</span>}
                </td>
                {(["VB", "BB", "SB", "BP"] as const).map((ct) => (
                  <td key={ct} style={{ ...tdStyle, textAlign: "center", padding: "3px 2px" }}>
                    {renderBandBadge(row[`${ct} Band` as keyof TopRiskRow] as number, true)}
                  </td>
                ))}
                <td style={{ ...tdStyle, textAlign: "center", padding: "3px 2px" }}>{renderBandBadge(row._maxBand, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** Container-owned state/callbacks the Treatment Summary renderer needs. */
export interface TreatmentSummaryRenderContext {
  dispName: (name: string) => string;
  setProjectName: (orig: string, display: string) => void;
  projectQuarterLabel: Record<string, string>;
}

// ── Treatment Summary renderer ────────────────────────────────────────────
export const renderTreatmentSummary = (
  ctx: TreatmentSummaryRenderContext,
  summaries: ProjectTreatmentSummary[],
  projectSegmentCounts: Record<string, number>,
) => {
  const { dispName, setProjectName, projectQuarterLabel } = ctx;
  return (
    <div style={{ padding: "6px 12px" }}>
      {summaries.map((summary) => {
        const total = projectSegmentCounts[summary.project] ?? 0;
        const sorted = Object.entries(summary.treatmentCounts).sort(([, a], [, b]) => b - a);
        return (
          <div key={summary.project} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #ede8f5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                <EditableText value={dispName(summary.project)} onChange={(v) => setProjectName(summary.project, v)} style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }} />
                {projectQuarterLabel[summary.project] && (
                  <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600 }}>({projectQuarterLabel[summary.project]})</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, background: "#f0e4f8", padding: "2px 8px", borderRadius: 10 }}>
                {summary.treatedSegments} / {total || "?"} segments treated
              </div>
            </div>
            {sorted.length === 0 ? <div style={{ fontSize: 11, color: "#aaa" }}>No treatments applied yet.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {sorted.map(([idStr, count]) => {
                  const id = parseInt(idStr);
                  const name = TREATMENT_NAMES[id] ?? `Treatment ${id}`;
                  const pct = total > 0 ? ((count / total) * 100).toFixed(0) : null;
                  return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 11, background: "#a020d0", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{id}</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{name}</div>
                        {total > 0 && <div style={{ height: 5, background: "#f0f0f0", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${pct}%`, background: "#a020d0", height: "100%", opacity: 0.7 }} /></div>}
                      </div>
                      <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, flexShrink: 0, width: 60, textAlign: "right" }}>
                        {count} seg{count !== 1 ? "s" : ""}{pct ? ` (${pct}%)` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
