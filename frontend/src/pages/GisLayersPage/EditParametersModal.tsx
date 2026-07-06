import { useEffect, useState } from "react";
import { Box, Button, Text, Dialog, Portal, Input, Checkbox } from "@chakra-ui/react";
import * as api from "../../api";
import type { ShapefileInfo } from "../../api";
import { toaster } from "../../components/ui/toaster";

interface EditParametersModalProps {
  file: ShapefileInfo | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditParametersModal({ file, onClose, onSaved }: EditParametersModalProps) {
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
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Edit Layer Parameters{file ? `: ${file.name}` : ""}</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" color="fg.muted" mb={4}>
                Choose which parameters this layer affects. This only corrects the labels shown
                in the GIS Layers list — it does not change how the layer is used in scoring.
              </Text>

              <Text fontWeight="600" mb={2} fontSize="sm">Affects (select one or more)</Text>
              <Box maxH="220px" overflowY="auto" borderWidth="1px" borderRadius="md" p={2} mb={3}>
                {parameterOptions.map(opt => (
                  <Box key={opt} py="4px">
                    <Checkbox.Root
                      checked={selected.has(opt)}
                      onCheckedChange={() => toggleParam(opt)}
                    >
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label fontSize="sm">{opt}</Checkbox.Label>
                    </Checkbox.Root>
                  </Box>
                ))}
              </Box>

              <Box display="flex" gap={2} mb={4}>
                <Input
                  placeholder="Add a custom parameter..."
                  size="sm"
                  value={customParam}
                  onChange={(e) => setCustomParam(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomParam(); } }}
                />
                <Button size="sm" onClick={addCustomParam} disabled={!customParam.trim()}>Add</Button>
              </Box>

              <Text fontWeight="600" mb={2} fontSize="sm">Required Columns (optional, informational)</Text>
              <Input
                placeholder="e.g. WIDTH, SURFACE_TYPE"
                size="sm"
                value={requiredColumns}
                onChange={(e) => setRequiredColumns(e.target.value)}
              />
            </Dialog.Body>
            <Dialog.Footer>
              <Box display="flex" gap={3} width="100%" justifyContent="flex-end">
                <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button colorPalette="blue" onClick={handleSave} disabled={saving}>
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
