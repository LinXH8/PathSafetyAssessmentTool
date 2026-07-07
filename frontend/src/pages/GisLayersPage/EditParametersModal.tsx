import { useEffect, useState } from "react";
import { Box, Button, Text, Dialog, Portal, Input, Checkbox } from "@chakra-ui/react";
import * as api from "../../api";
import type { ShapefileInfo } from "../../api";
import { toaster } from "../../components/ui/toaster";
import { FONT, COLOR, RADIUS } from "../../features/ui/designTokens";

interface EditParametersModalProps {
  file: ShapefileInfo | null;
  onClose: () => void;
  onSaved: () => void;
  /** v1 stays byte-identical (default); v2 applies DESIGN_GUIDE.md tokens only — no structural change. */
  variant?: "v1" | "v2";
}

// v2-only style tokens (§1/§4/§7/§9) — applied only when variant === "v2".
const v2Label = { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text };
const v2Caption = { fontFamily: FONT, fontWeight: 400, fontSize: "0.75rem", color: COLOR.gray500 };
const v2Body = { fontFamily: FONT, fontWeight: 400, fontSize: "1rem", color: COLOR.text };

export default function EditParametersModal({ file, onClose, onSaved, variant = "v1" }: EditParametersModalProps) {
  const v2 = variant === "v2";
  const [parameterOptions, setParameterOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customParam, setCustomParam] = useState("");
  const [requiredColumns, setRequiredColumns] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    api.getParameterOptions().then(setParameterOptions).catch(() => setParameterOptions([]));
    setRequiredColumns(file.required_columns && file.required_columns !== "None" ? file.required_columns : "");
    const existingAffects = (file.affects || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    setSelected(new Set(existingAffects));
    setCustomParam("");
  }, [file]);

  function toggleParam(param: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(param)) next.delete(param);
      else next.add(param);
      return next;
    });
  }

  function addCustomParam() {
    const trimmed = customParam.trim();
    if (!trimmed) return;
    setSelected(prev => new Set(prev).add(trimmed));
    if (!parameterOptions.includes(trimmed)) {
      setParameterOptions(prev => [...prev, trimmed]);
    }
    setCustomParam("");
  }

  async function handleSave() {
    if (!file) return;
    if (selected.size === 0 && !requiredColumns.trim()) {
      toaster.create({ description: "Select at least one parameter or enter required columns", type: "warning" });
      return;
    }
    try {
      setSaving(true);
      await api.setLayerMetadata(file.path, requiredColumns.trim(), Array.from(selected));
      toaster.create({ description: "Layer metadata updated", type: "success" });
      onSaved();
    } catch (error: any) {
      toaster.create({ description: error.message || "Failed to update layer metadata", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={!!file} onOpenChange={(e) => !e.open && onClose()} size="md">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            style={v2 ? { fontFamily: FONT, borderRadius: RADIUS, border: `1px solid ${COLOR.border}` } : undefined}
          >
            <Dialog.Header>
              <Dialog.Title style={v2 ? { fontFamily: FONT, fontWeight: 700, fontSize: "1.25rem", color: COLOR.text } : undefined}>
                Edit Layer Parameters{file ? `: ${file.name}` : ""}
              </Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" color="fg.muted" mb={4} style={v2 ? v2Caption : undefined}>
                Choose which parameters this layer affects. This only corrects the labels shown
                in the GIS Layers list — it does not change how the layer is used in scoring.
              </Text>

              <Text fontWeight="600" mb={2} fontSize="sm" style={v2 ? v2Label : undefined}>Affects (select one or more)</Text>
              <Box maxH="220px" overflowY="auto" borderWidth="1px" borderRadius="md" p={2} mb={3} style={v2 ? { borderColor: COLOR.border, borderRadius: RADIUS } : undefined}>
                {parameterOptions.map(opt => (
                  <Box key={opt} py="4px">
                    <Checkbox.Root
                      checked={selected.has(opt)}
                      onCheckedChange={() => toggleParam(opt)}
                      colorPalette={v2 ? "blue" : undefined}
                    >
                      <Checkbox.HiddenInput />
                      <Checkbox.Control style={v2 ? { width: "1rem", height: "1rem", borderColor: COLOR.borderInput, borderRadius: "0.125rem" } : undefined} />
                      <Checkbox.Label fontSize="sm" style={v2 ? v2Body : undefined}>{opt}</Checkbox.Label>
                    </Checkbox.Root>
                  </Box>
                ))}
              </Box>

              <Box display="flex" gap={2} mb={4}>
                <Input
                  placeholder="Add a custom parameter..."
                  size={v2 ? "md" : "sm"}
                  value={customParam}
                  onChange={(e) => setCustomParam(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomParam(); } }}
                  style={v2 ? { fontFamily: FONT, fontSize: "1rem", borderColor: COLOR.borderInput, borderRadius: RADIUS } : undefined}
                />
                <Button
                  size={v2 ? "md" : "sm"}
                  colorPalette={v2 ? "blue" : undefined}
                  onClick={addCustomParam}
                  disabled={!customParam.trim()}
                  style={v2 ? { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", borderRadius: RADIUS } : undefined}
                >
                  Add
                </Button>
              </Box>

              <Text fontWeight="600" mb={2} fontSize="sm" style={v2 ? v2Label : undefined}>Required Columns (optional, informational)</Text>
              <Input
                placeholder="e.g. WIDTH, SURFACE_TYPE"
                size={v2 ? "md" : "sm"}
                value={requiredColumns}
                onChange={(e) => setRequiredColumns(e.target.value)}
                style={v2 ? { fontFamily: FONT, fontSize: "1rem", borderColor: COLOR.borderInput, borderRadius: RADIUS } : undefined}
              />
            </Dialog.Body>
            <Dialog.Footer>
              <Box display="flex" gap={3} width="100%" justifyContent="flex-end">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={saving}
                  borderColor={v2 ? COLOR.borderInput : undefined}
                  color={v2 ? COLOR.text : undefined}
                  style={v2 ? { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", borderRadius: RADIUS } : undefined}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="blue"
                  onClick={handleSave}
                  disabled={saving}
                  style={v2 ? { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", borderRadius: RADIUS } : undefined}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
              </Box>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
