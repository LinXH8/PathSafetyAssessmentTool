import { useEffect, useMemo, useRef, useState } from "react";
import { LuFolderSearch, LuSearch, LuCheck, LuImport } from "react-icons/lu";
import { Spinner } from "@chakra-ui/react";
import { toaster } from "../../../components/ui/toaster";
import * as api from "../../../api";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import V2ModalShell, {
  modalLabelStyle,
  modalInputStyle,
  modalPrimaryBtn,
  modalGhostBtn,
} from "../../../components/common/V2ModalShell";

/**
 * Import Source modal (v2) — copy a local folder of survey images into an `in/`
 * source folder that project creation can read. Rebuilt on the shared
 * V2ModalShell (portal, no Chakra Dialog) so it matches the Import Project modal.
 */

interface ImageUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (details: { folderName: string }) => void;
}

type WorkflowStep = "upload" | "success";

export default function ImageUploadModal({ open, onClose, onSuccess }: ImageUploadModalProps) {
  const [step, setStep] = useState<WorkflowStep>("upload");
  const [sourcePath, setSourcePath] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderInputValue, setFolderInputValue] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<api.SourceFolderSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadedSuggestions, setLoadedSuggestions] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [renamedFrom, setRenamedFrom] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<api.SourceFolderPreview | null>(null);
  const comboRef = useRef<HTMLDivElement>(null);

  const filteredSuggestions = useMemo(
    () => suggestions.filter((item) => item.name.toLowerCase().includes(folderInputValue.toLowerCase())),
    [folderInputValue, suggestions]
  );
  const exactSuggestion = useMemo(
    () => suggestions.find((item) => item.name.toLowerCase() === folderName.trim().toLowerCase()),
    [folderName, suggestions]
  );

  useEffect(() => {
    if (!open) resetState();
  }, [open]);

  // Close the combobox dropdown on an outside click.
  useEffect(() => {
    if (!comboOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setComboOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [comboOpen]);

  function resetState() {
    setStep("upload");
    setSourcePath("");
    setFolderName("");
    setFolderInputValue("");
    setComboOpen(false);
    setSuggestions([]);
    setLoadedSuggestions(false);
    setLoadingSuggestions(false);
    setBrowsing(false);
    setUploading(false);
    setRenamedFrom(null);
    setImportPreview(null);
  }

  async function ensureSuggestionsLoaded() {
    if (loadedSuggestions || loadingSuggestions) return;
    try {
      setLoadingSuggestions(true);
      const items = await api.listSourceFolderSuggestions();
      setSuggestions(items);
      setLoadedSuggestions(true);
    } catch (error) {
      toaster.create({ description: `Failed to load folder suggestions: ${error}`, type: "error" });
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function handleClose() {
    if (step === "success" && onSuccess) onSuccess({ folderName });
    resetState();
    onClose();
  }

  async function handleBrowse() {
    try {
      setBrowsing(true);
      const result = await api.pickLocalSourceFolder();
      if (!result.path) return;
      setSourcePath(result.path);
      if (!folderName.trim() && result.suggested_folder_name) {
        setFolderName(result.suggested_folder_name);
        setFolderInputValue(result.suggested_folder_name);
      }
    } catch (error) {
      toaster.create({ description: `Browse failed: ${error}`, type: "error" });
    } finally {
      setBrowsing(false);
    }
  }

  async function handleUpload() {
    if (!sourcePath.trim()) {
      toaster.create({ description: "Please choose or paste a local folder path.", type: "warning" });
      return;
    }
    if (!folderName.trim()) {
      toaster.create({ description: "Please choose a destination source folder name.", type: "warning" });
      return;
    }

    try {
      setUploading(true);
      const result = await api.copyLocalImagesToSourceFolder(sourcePath.trim(), folderName.trim());
      const renamedDescription = result.renamed_from
        ? ` Renamed to "${result.folder_name}" using the detected survey quarter.`
        : "";

      if (result.errors.length > 0) {
        toaster.create({
          description: `Imported ${result.count} image(s) with ${result.errors.length} error(s).${renamedDescription}`,
          type: "warning",
        });
      } else {
        toaster.create({
          description: `Copied ${result.count} image(s) into folder "${result.folder_name}".${renamedDescription}`,
          type: "success",
        });
      }

      setFolderName(result.folder_name);
      setFolderInputValue(result.folder_name);
      setRenamedFrom(result.renamed_from);
      setImportPreview(result.preview);
      setStep("success");
    } catch (error) {
      toaster.create({ description: `Import failed: ${error}`, type: "error" });
    } finally {
      setUploading(false);
    }
  }

  const selectSuggestion = (name: string) => {
    setFolderName(name);
    setFolderInputValue(name);
    setComboOpen(false);
  };

  const footer = step === "success" ? (
    <button type="button" style={modalPrimaryBtn(false)} onClick={handleClose}>
      Done
    </button>
  ) : (
    <>
      <button
        type="button"
        style={modalGhostBtn(uploading || browsing)}
        disabled={uploading || browsing}
        onClick={handleClose}
      >
        Cancel
      </button>
      <button
        type="button"
        style={{
          ...modalPrimaryBtn(!sourcePath.trim() || !folderName.trim() || uploading || browsing),
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
        disabled={!sourcePath.trim() || !folderName.trim() || uploading || browsing}
        onClick={handleUpload}
      >
        <LuImport size={16} />
        {uploading ? "Importing…" : "Import Source"}
      </button>
    </>
  );

  return (
    <V2ModalShell
      open={open}
      onClose={handleClose}
      title={step === "upload" ? "Import Source" : "Source imported"}
      width={560}
      busy={uploading}
      footer={footer}
    >
      {step === "upload" ? (
        <>
          <span style={{ fontFamily: FONT, fontSize: 13, color: COLOR.gray600, lineHeight: 1.5 }}>
            Copy survey images straight from a folder on this machine into <code style={codeStyle}>in/</code>.
            This avoids slow browser uploads and keeps everything as one source folder instead of hundreds of
            individual files.
          </span>

          {/* Local folder path */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={modalLabelStyle}>Local folder path</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <LuFolderSearch size={18} color={COLOR.gray500} style={{ flexShrink: 0 }} />
              <input
                style={{ ...modalInputStyle, flex: 1 }}
                placeholder="e.g. C:\path\to\ANG MO KIO AVENUE 1"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
              />
              <button
                type="button"
                style={{ ...modalGhostBtn(browsing || uploading), flexShrink: 0 }}
                onClick={handleBrowse}
                disabled={browsing || uploading}
              >
                {browsing ? "Browsing…" : "Browse"}
              </button>
            </div>
            <span style={captionStyle}>
              Local folder browsing works only when the backend runs on this same machine.
            </span>
          </div>

          {/* Destination source folder combobox */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={modalLabelStyle}>Destination source folder</label>
            <div ref={comboRef} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <LuSearch size={18} color={COLOR.gray500} style={{ flexShrink: 0 }} />
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  style={modalInputStyle}
                  placeholder={loadingSuggestions ? "Loading roads and folders…" : "Search a road or source folder, or type a new name"}
                  value={folderInputValue}
                  disabled={uploading}
                  onChange={(e) => {
                    setFolderInputValue(e.target.value);
                    setFolderName(e.target.value);
                    setComboOpen(true);
                  }}
                  onFocus={() => {
                    setComboOpen(true);
                    void ensureSuggestionsLoaded();
                  }}
                />
                {comboOpen && (
                  <div style={dropdownStyle}>
                    {loadingSuggestions && filteredSuggestions.length === 0 && (
                      <div style={dropdownEmptyStyle}>Loading roads and folders…</div>
                    )}
                    {!loadingSuggestions && filteredSuggestions.length === 0 && (
                      <div style={dropdownEmptyStyle}>
                        {folderInputValue.trim() ? "No matches — a new folder will be created." : "No source folders yet."}
                      </div>
                    )}
                    {filteredSuggestions.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectSuggestion(item.name); }}
                        style={dropdownItemStyle}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                        <span style={{ fontSize: 12, color: item.exists ? "#2F855A" : COLOR.gray500, flexShrink: 0 }}>
                          {item.exists ? "existing" : "new"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <span style={captionStyle}>
              Search an existing source folder or road name, or type a new name to create one.
            </span>
            {folderName.trim() && (
              <span style={{ ...captionStyle, color: exactSuggestion?.exists ? "#2F855A" : COLOR.gray600 }}>
                {exactSuggestion?.exists
                  ? "Images will be copied into an existing source folder."
                  : "A new source folder will be created under in/."}
              </span>
            )}
          </div>

          {/* What this does */}
          <div style={infoBoxStyle}>
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: COLOR.text }}>What this does</span>
            <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray600, lineHeight: 1.5 }}>
              The backend copies image files directly from the selected folder into the destination source
              folder. Nested folders are flattened so project creation can read the images cleanly.
            </span>
          </div>

          {uploading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Spinner size="sm" color={COLOR.blue} />
              <span style={captionStyle}>Copying images into the source folder…</span>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", textAlign: "center" }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "#E6F4EA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LuCheck size={24} color="#2F855A" />
          </span>
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: COLOR.text }}>Import completed</span>
          <span style={{ fontFamily: FONT, fontSize: 13, color: COLOR.gray600, lineHeight: 1.5 }}>
            Source folder <strong style={{ color: COLOR.text }}>{folderName}</strong> is ready to use in
            project creation.
          </span>

          {renamedFrom && (
            <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.blue }}>
              Renamed from <strong>{renamedFrom}</strong> to include the detected survey quarter.
            </span>
          )}

          {importPreview && (
            <div style={{ ...infoBoxStyle, width: "100%", textAlign: "left" }}>
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: COLOR.text }}>Imported folder summary</span>
              <span style={summaryLine}>Segments: {importPreview.segment_count}</span>
              <span style={summaryLine}>
                Survey quarter: {importPreview.survey_quarter ?? (importPreview.survey_quarters.length > 0 ? importPreview.survey_quarters.join(", ") : "Unknown")}
              </span>
              <span style={summaryLine}>
                Source images: {importPreview.image_count} ({importPreview.geotagged_image_count} geotagged)
              </span>
              {importPreview.mixed_quarters && (
                <span style={{ ...summaryLine, color: COLOR.danger }}>
                  This folder spans multiple quarters. Keep quarter batches separated where possible.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </V2ModalShell>
  );
}

const captionStyle: React.CSSProperties = { fontFamily: FONT, fontSize: 12, color: COLOR.gray500, lineHeight: 1.4 };
const codeStyle: React.CSSProperties = { fontFamily: "monospace", fontSize: 12, background: COLOR.gray100, padding: "1px 5px", borderRadius: 4, color: COLOR.text };
const summaryLine: React.CSSProperties = { fontFamily: FONT, fontSize: 13, color: COLOR.gray600, lineHeight: 1.6 };

const infoBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  background: COLOR.canvas,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 6,
  padding: "12px 14px",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: COLOR.white,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 6,
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  maxHeight: 220,
  overflowY: "auto",
  zIndex: 3100,
};
const dropdownItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  padding: "9px 12px",
  textAlign: "left",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: COLOR.text,
  fontFamily: FONT,
  fontSize: 14,
};
const dropdownEmptyStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontFamily: FONT,
  fontSize: 13,
  color: COLOR.gray500,
};
