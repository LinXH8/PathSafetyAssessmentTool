import { useEffect, useRef, useState } from "react";
import { LuUpload, LuFileArchive, LuCheck } from "react-icons/lu";
import { toaster } from "../../../components/ui/toaster";
import { importProjects, type ImportProjectsResult } from "../../../api";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import V2ModalShell, { modalPrimaryBtn, modalGhostBtn } from "../../../components/common/V2ModalShell";

/**
 * Import Project modal (v2) — upload a .psat.zip bundle exported from the Home
 * page (Share → Export) and unpack the projects it contains into the active
 * profile. The bundle carries its own project names and (optionally) tags, so
 * the page's Name / Tags fields are ignored here.
 */

interface ImportProjectModalV2Props {
  open: boolean;
  onClose: () => void;
  /** Fired once after a successful import so the page can refresh its data. */
  onImported: (result: ImportProjectsResult) => void;
  /** Navigate to the Projects list (offered on the success screen). */
  onViewProjects: () => void;
}

export default function ImportProjectModalV2({
  open,
  onClose,
  onImported,
  onViewProjects,
}: ImportProjectModalV2Props) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportProjectsResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setImporting(false);
      setDragOver(false);
      setResult(null);
    }
  }, [open]);

  const isZip = (f: File) => /\.zip$/i.test(f.name);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!isZip(f)) {
      toaster.create({ description: "Please choose a .psat.zip bundle.", type: "warning" });
      return;
    }
    setFile(f);
  };

  const handleImport = async () => {
    if (!file || importing) return;
    try {
      setImporting(true);
      const res = await importProjects(file);
      setResult(res);
      onImported(res);

      if (res.imported.length > 0) {
        toaster.create({
          description: `Imported ${res.imported.length} project${res.imported.length === 1 ? "" : "s"}.`,
          type: "success",
        });
      } else if (res.skipped.length > 0) {
        toaster.create({
          description: "Nothing imported — every project in the bundle already exists.",
          type: "info",
        });
      } else {
        toaster.create({ description: "No projects were imported.", type: "warning" });
      }
    } catch (error) {
      toaster.create({
        description: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
        type: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  const footer = result ? (
    <>
      <button type="button" style={modalGhostBtn()} onClick={() => { setFile(null); setResult(null); }}>
        Import another
      </button>
      <button type="button" style={modalPrimaryBtn(false)} onClick={onViewProjects}>
        View Projects
      </button>
    </>
  ) : (
    <>
      <button type="button" style={modalGhostBtn(importing)} disabled={importing} onClick={() => !importing && onClose()}>
        Cancel
      </button>
      <button type="button" style={modalPrimaryBtn(!file || importing)} disabled={!file || importing} onClick={handleImport}>
        {importing ? "Importing…" : "Import"}
      </button>
    </>
  );

  return (
    <V2ModalShell open={open} onClose={onClose} title="Import Project" busy={importing} footer={footer}>
      {result ? (
        <ImportSummary result={result} />
      ) : (
        <>
          <span style={{ fontFamily: FONT, fontSize: 13, color: COLOR.gray600, lineHeight: 1.5 }}>
            Upload a <strong style={{ color: COLOR.text }}>.psat.zip</strong> bundle exported from the
            Projects page (Share → Export). Its projects are added to the current profile using the names
            saved in the bundle.
          </span>

          {/* Drop zone / file picker */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "26px 18px",
              border: `1.5px dashed ${dragOver ? COLOR.blue : COLOR.borderInput}`,
              borderRadius: 8,
              background: dragOver ? "#EBF4FC" : COLOR.canvas,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            {file ? <LuFileArchive size={26} color={COLOR.blue} /> : <LuUpload size={26} color={COLOR.gray500} />}
            {file ? (
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text, wordBreak: "break-all" }}>
                {file.name}
              </span>
            ) : (
              <span style={{ fontFamily: FONT, fontSize: 14, color: COLOR.gray600 }}>
                Click to choose a bundle, or drop it here
              </span>
            )}
            <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>
              {file ? "Click to choose a different file" : "Accepts a .psat.zip file"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              style={{ display: "none" }}
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          <div
            style={{
              fontFamily: FONT,
              fontSize: 12,
              color: COLOR.gray500,
              lineHeight: 1.5,
            }}
          >
            Projects whose name already exists in this profile are skipped, not overwritten.
          </div>
        </>
      )}
    </V2ModalShell>
  );
}

function ImportSummary({ result }: { result: ImportProjectsResult }) {
  const { imported, skipped, errors } = result;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: imported.length > 0 ? "#E6F4EA" : COLOR.gray100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LuCheck size={16} color={imported.length > 0 ? "#2F855A" : COLOR.gray500} />
        </span>
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text }}>
          {imported.length > 0 ? "Import complete" : "Nothing imported"}
        </span>
      </div>

      {imported.length > 0 && (
        <SummaryBlock label={`Imported (${imported.length})`} names={imported} color={COLOR.text} />
      )}
      {skipped.length > 0 && (
        <SummaryBlock
          label={`Skipped — already exists (${skipped.length})`}
          names={skipped.map((s) => s.name)}
          color={COLOR.gray600}
        />
      )}
      {errors.length > 0 && (
        <SummaryBlock
          label={`Failed (${errors.length})`}
          names={errors.map((e) => `${e.name} — ${e.reason}`)}
          color={COLOR.danger}
        />
      )}
    </div>
  );
}

function SummaryBlock({ label, names, color }: { label: string; names: string[]; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color }}>{label}</span>
      <ul style={{ margin: 0, paddingLeft: 18, listStyle: "disc" }}>
        {names.map((n) => (
          <li key={n} style={{ fontFamily: FONT, fontSize: 13, color: COLOR.text, lineHeight: 1.6 }}>
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}
