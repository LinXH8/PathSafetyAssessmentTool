import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { toaster } from "../../../components/ui/toaster";
import * as api from "../../../api";
import { getTagColor } from "../tagColor";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import type { ProjectListItem } from "../../../api";

/**
 * v2 Edit Project modal — the FIRST popup designed natively in the v2 language
 * (all other dialogs are still v1 Chakra ports). Deliberately built as a plain
 * portal overlay instead of Chakra's <Dialog>, which sidesteps the Zag/Chakra
 * pointer-events freeze bug documented in CLAUDE.md entirely.
 *
 * Handles BOTH:
 *   - single selection → edit name + tags for that one project.
 *   - multi selection   → edit a shared tag set applied to ALL selected
 *     projects (names are per-project unique, so name editing is single-only).
 */

interface EditProjectModalV2Props {
  open: boolean;
  onClose: () => void;
  projects: ProjectListItem[];
  onSuccess: (
    updates: Array<{ oldName: string; newName: string; tags: string[] }>
  ) => void;
}

export default function EditProjectModalV2({
  open,
  onClose,
  projects,
  onSuccess,
}: EditProjectModalV2Props) {
  const isMulti = projects.length > 1;
  const single = projects.length === 1 ? projects[0] : null;

  // Union of every selected project's tags — the starting point for the shared
  // tag editor (sorted for a stable display).
  const initialTags = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [projects]);

  const [newName, setNewName] = useState(single?.name ?? "");
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the form whenever the modal (re)opens for a different selection.
  useEffect(() => {
    if (open) {
      setNewName(single?.name ?? "");
      setTags(initialTags);
      setTagInput("");
      // Focus the primary field once the overlay is painted.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, single?.name, initialTags]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      const trimmed = tagInput.trim();
      if (trimmed && !tags.includes(trimmed)) setTags((t) => [...t, trimmed]);
      setTagInput("");
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((t) => t.slice(0, -1));
    }
  }

  const removeTag = (tag: string) => setTags((t) => t.filter((x) => x !== tag));

  async function handleSave() {
    if (single && !newName.trim()) {
      toaster.create({
        title: "Validation Error",
        description: "Project name cannot be empty",
        type: "error",
      });
      return;
    }

    setSaving(true);
    try {
      if (single) {
        // Single edit: only send changed fields.
        const updates: { new_name?: string; tags?: string[] } = {};
        if (newName !== single.name) updates.new_name = newName.trim();
        if (JSON.stringify(tags) !== JSON.stringify(single.tags ?? [])) updates.tags = tags;

        if (Object.keys(updates).length === 0) {
          toaster.create({ title: "No Changes", description: "No changes to save", type: "info" });
          onClose();
          return;
        }

        const result = await api.updateProject(single.name, updates);
        onSuccess([
          {
            oldName: single.name,
            newName: result.name || newName.trim(),
            tags: result.tags || tags,
          },
        ]);
        toaster.create({ title: "Success", description: "Project updated successfully", type: "success" });
        onClose();
        return;
      }

      // Multi edit: apply the shared tag set to every selected project. Skip any
      // project already carrying exactly this set to avoid needless writes.
      const targetKey = JSON.stringify(tags);
      const changedProjects = projects.filter(
        (p) => JSON.stringify((p.tags ?? []).slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))) !== targetKey
      );

      if (changedProjects.length === 0) {
        toaster.create({ title: "No Changes", description: "All selected projects already have these tags", type: "info" });
        onClose();
        return;
      }

      const results = await Promise.allSettled(
        changedProjects.map((p) => api.updateProject(p.name, { tags }))
      );

      const updates: Array<{ oldName: string; newName: string; tags: string[] }> = [];
      let failed = 0;
      results.forEach((r, i) => {
        const p = changedProjects[i];
        if (r.status === "fulfilled") {
          updates.push({ oldName: p.name, newName: r.value.name || p.name, tags: r.value.tags || tags });
        } else {
          failed += 1;
        }
      });

      if (updates.length > 0) onSuccess(updates);

      if (failed === 0) {
        toaster.create({
          title: "Tags updated",
          description: `Applied tags to ${updates.length} project${updates.length === 1 ? "" : "s"}.`,
          type: "success",
        });
      } else {
        toaster.create({
          title: updates.length > 0 ? "Partially updated" : "Update Failed",
          description: `${updates.length} updated, ${failed} failed.`,
          type: updates.length > 0 ? "warning" : "error",
        });
      }
      onClose();
    } catch (error: any) {
      toaster.create({
        title: "Update Failed",
        description: error?.message || "Failed to update project",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text };
  const inputStyle: React.CSSProperties = {
    boxSizing: "border-box",
    width: "100%",
    height: 40,
    padding: "8px 12px",
    border: `1px solid ${COLOR.borderInput}`,
    borderRadius: 6,
    fontFamily: FONT,
    fontSize: 16,
    outline: "none",
    background: COLOR.white,
    color: COLOR.text,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isMulti ? "Edit projects" : "Edit project"}
      onMouseDown={() => {
        if (!saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(26, 32, 44, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: COLOR.white,
          border: `1px solid ${COLOR.border}`,
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderBottom: `1px solid ${COLOR.border}`,
          }}
        >
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text }}>
            {isMulti ? `Edit ${projects.length} Projects` : "Edit Project"}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !saving && onClose()}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 24,
              lineHeight: 1,
              color: COLOR.gray500,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 22 }}>
          {single ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>Project Name</label>
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter project name"
                style={inputStyle}
              />
            </div>
          ) : (
            <div
              style={{
                background: COLOR.gray100,
                border: `1px solid ${COLOR.border}`,
                borderRadius: 6,
                padding: "10px 12px",
                fontFamily: FONT,
                fontSize: 13,
                color: COLOR.gray600,
                lineHeight: 1.5,
              }}
            >
              Tags below will be applied to all{" "}
              <strong style={{ color: COLOR.text }}>{projects.length}</strong> selected projects.
              Project names are unique and can only be edited one at a time.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>Tags</label>
            <div
              style={{
                boxSizing: "border-box",
                width: "100%",
                minHeight: 40,
                padding: "6px 8px",
                border: `1px solid ${COLOR.borderInput}`,
                borderRadius: 6,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
                background: COLOR.white,
              }}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: getTagColor(tag),
                    color: COLOR.white,
                    borderRadius: 999,
                    padding: "2px 10px",
                    fontFamily: FONT,
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                    style={{ background: "transparent", border: "none", color: COLOR.white, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={tags.length === 0 ? "Type a tag and press comma or enter" : "Add tag…"}
                style={{ flex: 1, minWidth: 120, border: "none", outline: "none", fontFamily: FONT, fontSize: 16, background: "transparent", color: COLOR.text }}
              />
            </div>
            <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>
              Press comma (,) or Enter to add a tag
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            padding: "16px 22px",
            borderTop: `1px solid ${COLOR.border}`,
          }}
        >
          <button
            type="button"
            onClick={() => !saving && onClose()}
            disabled={saving}
            style={{
              height: 40,
              padding: "0 18px",
              background: COLOR.white,
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              color: COLOR.text,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              height: 40,
              padding: "0 18px",
              background: saving ? COLOR.gray400 : COLOR.blue,
              border: "none",
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              color: COLOR.white,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
