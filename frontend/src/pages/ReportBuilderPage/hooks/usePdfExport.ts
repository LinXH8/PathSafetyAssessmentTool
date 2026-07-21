/**
 * usePdfExport.ts — the Report Builder's PDF + Word export pipeline.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). Owns the
 * `exporting` status flag and the three export routines, which only *read* the
 * report's derived state (passed in via params) and rasterise / POST it — a leaf
 * seam with no coupling back into the container's layout web.
 *
 * Load-bearing behaviours preserved exactly (see root CLAUDE.md):
 *  - the `<img>`-decode guard before capture (no blank images),
 *  - the `captureScale` clamp against the browser's ~32767px / ~268M px² canvas
 *    limits (MAX_DIM / MAX_AREA) + the fail-loud empty-canvas guard and `alert`,
 *  - the `onclone` form-control → `<div>` swap for html2canvas-pro baseline fix,
 *  - the silent server persist to the Generated Reports folder.
 *
 * Side effects: html2canvas rasterisation, `jsPDF.save`, `saveGeneratedReport`
 * POST, `/api/report/generate-docx` POST, and a browser file download.
 */
import { useCallback, useState } from "react";
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import { saveGeneratedReport } from "../../../api";
import { CANVAS_W, FILTERED_SECTIONS_ENABLED, PAGE_H, TREATMENT_NAMES } from "../reportBuilderConstants";
import type {
  ElementState, FilterCategoryStatus, ReportDataset, TopRiskRow,
} from "../reportBuilderTypes";

/** One quarter's aggregated image-date range + member projects. */
interface QuarterRange { label: string; earliest: string; latest: string; projects: string[] }

/** Everything the export pipeline reads from the container. */
export interface UsePdfExportParams {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  elements: ElementState[];
  fullDataset: ReportDataset;
  getSegmentTreatments: (row: TopRiskRow) => number[];
  loadedProjects: string[];
  reportTitle: string;
  oicName: string;
  purpose: string;
  reportDate: string;
  quarterData: QuarterRange[];
  recommendations: string;
  projectMeta: Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }>;
  activeFilterNames: string[];
  activeCategoryStatus: FilterCategoryStatus[];
  projectNameOverrides: Record<string, string>;
  sectionTitles: Record<string, string>;
}

export interface UsePdfExportResult {
  exporting: "pdf" | "word" | null;
  handleDownloadPDF: () => Promise<void>;
  handleDownloadWord: () => Promise<void>;
}

/**
 * Provide the report's PDF and Word export handlers plus the shared `exporting`
 * status flag (drives the toolbar buttons' disabled / "Generating…" state).
 */
export function usePdfExport({
  canvasRef, elements, fullDataset, getSegmentTreatments, loadedProjects,
  reportTitle, oicName, purpose, reportDate, quarterData, recommendations,
  projectMeta, activeFilterNames, activeCategoryStatus, projectNameOverrides,
  sectionTitles,
}: UsePdfExportParams): UsePdfExportResult {
  const [exporting, setExporting] = useState<"pdf" | "word" | null>(null);

  const handleDownloadPDF = useCallback(async () => {
    if (!canvasRef.current) return;
    setExporting("pdf");
    try {
      const canvas = canvasRef.current;
      const restore: Array<() => void> = [];

      // Hide decorative page labels so they don't appear in the PDF,
      // and hide Leaflet controls (which include the attribution watermark that
      // html2canvas often renders as a black box, plus interactive zoom buttons).
      canvas.querySelectorAll<HTMLElement>(".rb-page-label, .leaflet-control-container").forEach((el) => {
        const prev = el.style.visibility;
        el.style.visibility = "hidden";
        restore.push(() => { el.style.visibility = prev; });
      });

      // Remove box-shadow from the page backgrounds during export.
      // html2canvas has a known bug where box-shadows on large elements stretch
      // into massive black gradients/watermarks when the canvas height is huge.
      canvas.querySelectorAll<HTMLElement>(".rb-page-bg").forEach((el) => {
        const prev = el.style.boxShadow;
        el.style.boxShadow = "none";
        restore.push(() => { el.style.boxShadow = prev; });
      });

      // WYSIWYG capture — do NOT mutate section heights here.
      //
      // The canvas is A4-proportioned by construction (CANVAS_W 794px ≈ 210mm,
      // PAGE_H 1123px ≈ 297mm at 96 DPI). `computeFlowLayout` + `avoidPageBreak`
      // insert `marginTop` spacers so no section straddles a PAGE_H boundary, and
      // the PDF below slices the captured image on that exact same 297mm/PAGE_H
      // grid. The preview draws its page-break markers on the same grid too.
      //
      // Previously this function expanded every `.rb-element` to its scrollHeight
      // (to reveal text that overflowed the estimated section height). But the
      // image is still sliced on the fixed PAGE_H grid, so any expanded section
      // pushed all following sections downward → positions no longer matched the
      // preview, sections straddled page breaks (the marginTop spacers were
      // computed for the un-expanded heights), and the map (a later section) was
      // displaced. Each section is already sized to its content by
      // `computeIdealHeight` in the preview, so capturing the canvas exactly as
      // rendered keeps the PDF identical to what the user sees and aligned to the
      // page grid. (If a section ever clips, fix its `computeIdealHeight` estimate
      // so the preview grows too — never re-expand only at export time.)
      //
      // html2canvas renders the text of native form controls (<input>, <textarea>)
      // with broken vertical alignment — the value/placeholder is drawn *below* the
      // box (visible on the Title section's OIC/Purpose/Date fields). Fix it in the
      // cloned capture doc only (live UI untouched): replace each field with a <div>
      // holding the same text, vertically centred via flex. Match each clone to its
      // live counterpart by index to copy the exact rendered height so layout (and
      // thus the page-break grid) is preserved.
      const liveFields = Array.from(
        canvas.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
      ).filter((f) => !(f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")));

      // Ensure every <img> (segment photos, etc.) has finished decoding before
      // capture — html2canvas draws whatever is loaded at call time, so an export
      // fired right after the page loads could otherwise capture blank images.
      await Promise.all(
        Array.from(canvas.querySelectorAll("img"))
          .filter((img) => !img.complete)
          .map((img) => img.decode().catch(() => undefined)),
      );

      // Clamp the capture scale so the rasterised canvas stays within the
      // browser's hard limits. Browsers cap a <canvas> at ~32767px per dimension
      // and ~268M px² total area; html2canvas silently returns a blank/zero-size
      // canvas when exceeded (→ empty toDataURL → failed PDF). Tall reports —
      // especially with the doubled "(Filtered)" sections — blow past this at the
      // default scale of 2, so derive the largest safe scale instead.
      const cssW = canvas.scrollWidth || canvas.offsetWidth || CANVAS_W;
      const cssH = canvas.scrollHeight || canvas.offsetHeight || PAGE_H;
      const MAX_DIM = 32000;                 // per-dimension cap, with margin
      const MAX_AREA = 256 * 1024 * 1024;    // ~268M px² area cap, with margin
      const captureScale = Math.max(
        0.5,
        Math.min(2, MAX_DIM / cssW, MAX_DIM / cssH, Math.sqrt(MAX_AREA / (cssW * cssH))),
      );

      const captured = await html2canvas(canvas, {
        scale: captureScale, useCORS: true, logging: false, backgroundColor: "#ffffff",
        onclone: (doc) => {
          const cloneFields = Array.from(
            doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".rb-canvas input, .rb-canvas textarea"),
          ).filter((f) => !(f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")));
          cloneFields.forEach((field, i) => {
            const live = liveFields[i];
            const isArea = field.tagName === "TEXTAREA";
            const div = doc.createElement("div");
            div.style.cssText = field.style.cssText;       // same box/padding/border/font
            div.style.boxSizing = "border-box";
            div.style.display = "flex";
            div.style.alignItems = isArea ? "flex-start" : "center";
            div.style.whiteSpace = isArea ? "pre-wrap" : "nowrap";
            div.style.overflow = "hidden";
            // Native form controls render their value/placeholder oddly under
            // html2canvas(-pro), so swap to a <div>. With the baseline fix in
            // html2canvas-pro, flex align-items:center now centres correctly.
            // Match the clone to its live counterpart by index to copy the exact
            // offsetHeight (the clone isn't laid out when onclone runs).
            if (live) div.style.height = `${live.offsetHeight}px`;
            const val = field.value;
            div.textContent = val || field.placeholder || "";
            if (!val && field.placeholder) div.style.color = "#aaa";
            field.parentNode?.replaceChild(div, field);
          });
        },
      });

      restore.forEach((fn) => fn());

      // A zero-size capture means the canvas still exceeded a browser limit —
      // fail loudly instead of saving an empty PDF.
      if (!captured.width || !captured.height) {
        throw new Error(`html2canvas produced an empty canvas (${cssW}×${cssH}px @ ${captureScale.toFixed(2)}x). The report is too large to rasterise — hide some sections or reduce the number of Top Risk Stretches.`);
      }

      const imgData = captured.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfW = 210, pdfH = 297;
      const imgH = (captured.height * pdfW) / captured.width;
      let remaining = imgH, yPos = 0;
      pdf.addImage(imgData, "PNG", 0, yPos, pdfW, imgH);
      remaining -= pdfH;
      while (remaining > 0) { yPos -= pdfH; pdf.addPage(); pdf.addImage(imgData, "PNG", 0, yPos, pdfW, imgH); remaining -= pdfH; }
      pdf.save("PSAT_Report.pdf");

      // Silently persist a copy to the server's Generated Reports folder.
      // Failure here must not interrupt the user's browser download.
      try {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
        const serverFilename = `PSAT_Report_${timestamp}.pdf`;
        const pdfBlob = pdf.output("blob");
        await saveGeneratedReport(pdfBlob, serverFilename);
      } catch (saveErr) {
        console.error("Failed to save report to Generated Reports folder:", saveErr);
      }
    } catch (err) {
      console.error("PDF export failed:", err);
      alert(`PDF export failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    finally { setExporting(null); }
  }, [canvasRef]);

  // Capture a canvas element body as a base64 PNG (used for the Word map embed).
  const captureElementImage = useCallback(async (elementId: string): Promise<string | null> => {
    const el = canvasRef.current?.querySelector(`[data-element-id="${elementId}"] .rb-element-body`) as HTMLElement | null;
    if (!el) return null;
    await new Promise((r) => setTimeout(r, 800)); // let map tiles finish loading
    try {
      const captured = await html2canvas(el, {
        useCORS: true, allowTaint: false, scale: 1.5, logging: false, backgroundColor: "#ffffff",
        imageTimeout: 20000,
      });
      return captured.toDataURL("image/png").split(",")[1];
    } catch { return null; }
  }, [canvasRef]);

  const handleDownloadWord = useCallback(async () => {
    setExporting("word");
    const topN = elements.find((e) => e.id === "topRisk")?.topN ?? 10;
    const topRows = fullDataset.topRiskRows.slice(0, topN).map((row) => ({ ...row, _treatments: getSegmentTreatments(row) }));

    // Capture visual sections as images for Word embed
    const visibleIds = new Set(elements.filter((e) => e.visible).map((e) => e.id));
    const [mapImageB64] = await Promise.all([
      visibleIds.has("map") ? captureElementImage("map") : Promise.resolve(null),
    ]);

    try {
      const res = await fetch("/api/report/generate-docx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedProjects: loadedProjects,
          elements: elements.filter((el) => el.visible && (FILTERED_SECTIONS_ENABLED || !el.filtered)),
          scoreData: fullDataset.distributions,
          totalSegments: fullDataset.totalSegments,
          topRiskRows: topRows,
          treatmentSummaries: fullDataset.treatmentSummaries,
          treatmentNames: TREATMENT_NAMES,
          reportTitle,
          oicName,
          purpose,
          reportDate,
          quarterRanges: quarterData.map(({ label, earliest, latest, projects }) => ({ label, earliest, latest, projects })),
          recommendations,
          scoreStats: fullDataset.scoreStats,
          attributeFrequency: Object.fromEntries(fullDataset.attributeFrequency),
          projectSegmentCounts: fullDataset.projectSegmentCounts,
          projectMeta,
          activeFilterNames,
          activeCategoryStatus,
          projectDisplayNames: projectNameOverrides,
          sectionTitles,
          mapImageB64,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "PSAT_Report.docx";
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { console.error("Word export failed:", err); }
    finally { setExporting(null); }
  }, [
    captureElementImage, elements, fullDataset, getSegmentTreatments, loadedProjects,
    reportTitle, oicName, purpose, reportDate, quarterData, recommendations,
    projectMeta, activeFilterNames, activeCategoryStatus, projectNameOverrides, sectionTitles,
  ]);

  return { exporting, handleDownloadPDF, handleDownloadWord };
}
