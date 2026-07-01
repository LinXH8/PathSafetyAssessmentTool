import { useState, type KeyboardEvent } from "react";
import { FONT, COLOR } from "../../features/ui/designTokens";
import { getTagColor } from "../../pages/Projects/tagColor";

/**
 * v2 tag editor with autocomplete — shared by Edit Project and Create Project.
 *
 * Mirrors the "Search by Tags" field in ProjectsLayoutV2: a chip bar with an
 * inline text input and a suggestion dropdown drawn from `suggestions`. Adding
 * a tag accepts either a suggestion click, or Enter/comma on free text.
 */

interface TagInputV2Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** All known tags to offer as autocomplete suggestions. */
  suggestions?: string[];
  placeholder?: string;
  /** Optional autofocus on the text input. */
  inputRef?: React.Ref<HTMLInputElement>;
}

export default function TagInputV2({
  tags,
  onChange,
  suggestions = [],
  placeholder,
  inputRef,
}: TagInputV2Props) {
  const [tagInput, setTagInput] = useState("");
  const [open, setOpen] = useState(false);

  const filteredOptions = suggestions.filter(
    (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(t)
  );

  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setTagInput("");
  };

  const removeTag = (tag: string) => onChange(tags.filter((x) => x !== tag));

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(filteredOptions.length > 0 && filteredOptions[0].toLowerCase() === tagInput.trim().toLowerCase()
          ? filteredOptions[0]
          : tagInput);
      } else if (filteredOptions.length > 0) {
        addTag(filteredOptions[0]);
      }
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div style={{ position: "relative" }}>
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
          ref={inputRef}
          value={tagInput}
          onChange={(e) => {
            setTagInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? (tags.length === 0 ? "Type a tag and press comma or enter" : "Add tag…")}
          style={{ flex: 1, minWidth: 120, border: "none", outline: "none", fontFamily: FONT, fontSize: 16, background: "transparent", color: COLOR.text }}
        />
      </div>
      {open && filteredOptions.length > 0 && (
        <div
          style={{
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
            zIndex: 20,
          }}
        >
          {filteredOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(tag);
              }}
              style={{ display: "block", width: "100%", padding: "9px 12px", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", color: COLOR.text, fontFamily: FONT, fontSize: 16 }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
