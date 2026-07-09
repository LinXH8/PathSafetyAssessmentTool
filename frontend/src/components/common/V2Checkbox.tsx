/**
 * V2Checkbox — the DESIGN_GUIDE §7 checkbox (16×16, 1px #CBD5E0 border, radius 2px,
 * transparent fill; checked = blue #3182CE fill+border with a white check).
 *
 * Byte-for-byte the same box the Home/Projects table uses (`checkboxBox` +
 * `LuCheck` in ProjectsLayoutV2) — extracted so other v2 surfaces render an
 * identical control instead of a browser-native `accentColor` checkbox.
 *
 * Stops pointer-down propagation so it can live inside a dnd-kit draggable row
 * without starting a drag. Side effects: none.
 */
import { LuCheck } from "react-icons/lu";
import { COLOR } from "../../features/ui/designTokens";

export function V2Checkbox({
  checked, onToggle, disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      onClick={disabled ? undefined : onToggle}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: "1rem", height: "1rem", borderRadius: "0.125rem", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${checked ? COLOR.blue : COLOR.borderInput}`,
        background: checked ? COLOR.blue : COLOR.white,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {checked && <LuCheck size={10} color="#fff" strokeWidth={3} />}
    </div>
  );
}
