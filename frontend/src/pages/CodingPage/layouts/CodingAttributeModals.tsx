import { useState, useEffect } from "react";
import { Box, Dialog, Text, Input, Button, Portal } from "@chakra-ui/react";
import AttributeOptionsDialog from "../components/AttributeOptionsDialog";
import { FO_TYPE_SUGGESTIONS, NFO_TYPE_SUGGESTIONS, DEFECT_TYPE_SUGGESTIONS, FACILITY_WIDTH_SUBCATEGORY_MAP } from "../codingConstants";
import type { CodingViewModel } from "./CodingViewModel";

export function getParentCategoryForSubcat(subCat: string | null | undefined): string | null {
  if (!subCat) return null;
  for (const [parent, children] of Object.entries(FACILITY_WIDTH_SUBCATEGORY_MAP)) {
    if (children.includes(subCat)) return parent;
  }
  return null;
}

export function PresentMultiTagModal({
  open,
  options,
  onConfirm,
  onCancel,
  title,
  description,
  singleSelect = false,
}: {
  open: boolean;
  options: string[];
  onConfirm: (val: string) => void;
  onCancel?: () => void;
  title: string;
  description: string;
  singleSelect?: boolean;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showOthersInput, setShowOthersInput] = useState(false);
  const [othersText, setOthersText] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedTags([]);
      setShowOthersInput(false);
      setOthersText("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        document.body.style.pointerEvents = "auto";
        document.documentElement.style.pointerEvents = "auto";
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
        document.body.removeAttribute("data-scroll-locked");
        document.documentElement.removeAttribute("data-scroll-locked");
      }, 400);
      return () => clearTimeout(t);
    }
  }, [open]);

  function toggleTag(tag: string) {
    if (singleSelect) {
      setSelectedTags([tag]);
    } else {
      setSelectedTags((prev) =>
        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
      );
    }
  }

  function handleAddOthers() {
    const trimmed = othersText.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setOthersText("");
    setShowOthersInput(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={() => { }} unmountOnExit>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="420px" w="full">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" mb="3">
                {description}
              </Text>
              <Box display="flex" flexWrap="wrap" gap="2">
                {options.map((opt) => {
                  const selected = selectedTags.includes(opt);
                  return (
                    <Box
                      key={opt}
                      as="button"
                      px="3"
                      py="1.5"
                      borderRadius="full"
                      borderWidth="2px"
                      borderColor={selected ? "blue.500" : "gray.200"}
                      bg={selected ? "blue.50" : "white"}
                      color={selected ? "blue.800" : "gray.700"}
                      fontWeight={selected ? "semibold" : "normal"}
                      fontSize="sm"
                      cursor="pointer"
                      _hover={{ borderColor: "blue.400", bg: "blue.50" }}
                      _dark={{
                        bg: selected ? "blue.900" : "gray.800",
                        borderColor: selected ? "blue.400" : "gray.600",
                        color: selected ? "blue.200" : "gray.300",
                      }}
                      transition="all 0.15s"
                      onClick={() => toggleTag(opt)}
                    >
                      {opt}
                    </Box>
                  );
                })}
                {!singleSelect && (
                  <Box
                    as="button"
                    px="3"
                    py="1.5"
                    borderRadius="full"
                    borderWidth="2px"
                    borderColor="gray.300"
                    bg="white"
                    color="gray.600"
                    fontSize="sm"
                    cursor="pointer"
                    _hover={{ borderColor: "blue.400", bg: "blue.50" }}
                    _dark={{ bg: "gray.800", borderColor: "gray.500", color: "gray.300" }}
                    transition="all 0.15s"
                    onClick={() => setShowOthersInput(true)}
                  >
                    + Others
                  </Box>
                )}
              </Box>
              {showOthersInput && (
                <Box display="flex" gap="2" mt="3">
                  <Input
                    size="sm"
                    placeholder="Enter custom value..."
                    value={othersText}
                    onChange={(e) => setOthersText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddOthers(); }
                    }}
                    autoFocus
                  />
                  <Button size="sm" variant="outline" onClick={handleAddOthers} disabled={!othersText.trim()}>
                    Add
                  </Button>
                </Box>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              {onCancel && (
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button
                colorPalette="blue"
                disabled={selectedTags.length === 0}
                onClick={() => onConfirm(selectedTags.join(", "))}
              >
                Confirm
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/**
 * Shared attribute-editing modal stack for the Coding page — the
 * AttributeOptionsDialog plus the six forced multi-tag selection prompts
 * (Delineation present/not-present, FO/NFO Type, slippery issue, facility-width
 * sub-category). Identical between the v1 and v2 layouts, so it lives here and
 * both shells render `<CodingAttributeModals {...vm} />`. Pure function of the
 * view-model.
 */
export default function CodingAttributeModals(vm: CodingViewModel) {
  const {
    editingOptions,
    setEditingOptions,
    attrMappings,
    editCurrentAttr,
    editCurrentAttrMany,
    projectData,
    handleSaveOptions,
    onEdit,
    presentDelineationTypeOptions,
    foTypeOptions,
    nfoTypeOptions,
    slipperyIssueTypeOptions,
    defectTypeOptions,
    pendingPresentDelineationChange,
    setPendingPresentDelineationChange,
    pendingNotPresentDelineationChange,
    setPendingNotPresentDelineationChange,
    pendingPresentFOChange,
    setPendingPresentFOChange,
    pendingPresentNFOChange,
    setPendingPresentNFOChange,
    pendingPresentSlipperyChange,
    setPendingPresentSlipperyChange,
    pendingPresentDefectChange,
    setPendingPresentDefectChange,
    pendingFacilityWidthParentChange,
    setPendingFacilityWidthParentChange,
  } = vm;

  return (
    <>
      <AttributeOptionsDialog
        open={editingOptions !== null}
        onClose={() => setEditingOptions(null)}
        fieldName={editingOptions?.field ?? ""}
        currentValue={editingOptions?.currentValue ?? null}
        delineationNotPresent={editingOptions?.delineationNotPresent}
        singleSelect={
          editingOptions?.field === "Facility Width Sub-category" ||
          editingOptions?.field === "Crossing Type" ||
          editingOptions?.field === "Curvature Sub-category"
        }
        facilityWidthConfirm={
          editingOptions?.field === "Facility Width Sub-category"
            ? {
                oldSubCategory: editingOptions.currentValue ?? null,
                oldCategory: getParentCategoryForSubcat(editingOptions.currentValue),
                getNewCategory: (tag) => getParentCategoryForSubcat(tag),
              }
            : undefined
        }
        onSetValue={(val) => {
          if (!editingOptions) return;
          if (editingOptions.field === "Facility Width Sub-category" && val) {
            const newParent = getParentCategoryForSubcat(val);
            if (newParent) {
              const dict = attrMappings["Facility Width per Direction"] ?? {};
              const entry = Object.entries(dict).find(([, label]) => label === newParent);
              const rawCode = entry?.[0];
              const code = rawCode !== undefined
                ? (isNaN(Number(rawCode)) ? rawCode : Number(rawCode))
                : null;
              editCurrentAttrMany({
                "Facility Width Sub-category": val,
                ...(code !== null ? { "Facility Width per Direction": code } : {}),
              });
              return;
            }
          }
          editCurrentAttr(editingOptions.field, val);
        }}
        options={editingOptions
          ? (() => {
            const field = editingOptions.field;
            // Seed with predefined suggestions so FO/NFO Type edits always show the full list
            const seeds = field === "FO Type" ? FO_TYPE_SUGGESTIONS
              : field === "NFO Type" ? NFO_TYPE_SUGGESTIONS
              : field === "Defect Type" ? DEFECT_TYPE_SUGGESTIONS
              : [];
            const projectVals = Object.values(projectData)
              .flatMap((pd) => pd?.attrs ?? [])
              .flatMap((row) => {
                const v = row[field];
                if (v == null || String(v).trim() === "") return [];
                return String(v).split(",").map((s) => s.trim()).filter(Boolean);
              });
            return Array.from(new Set([...seeds, ...projectVals])).sort();
          })()
          : []}
        onSave={handleSaveOptions}
        onSetParentNotPresent={
          editingOptions?.field === "FO Type"
            ? () => onEdit("Fixed Obstacle on Facility", 2)
            : editingOptions?.field === "NFO Type"
            ? () => onEdit("Non-Fixed Obstacle on Facility", 2)
            : editingOptions?.field === "Delineation Type" && !editingOptions?.delineationNotPresent
            ? () => onEdit("Delineation", 2)
            : editingOptions?.field === "Issue Type (Slippery)"
            ? () => onEdit("Loose or slippery surface", 2)
            : editingOptions?.field === "Crossing Type"
            ? () => onEdit("Crossing Facility", 2)
            : editingOptions?.field === "Defect Type"
            ? () => onEdit("Major Surface Deformation or Drain Opening", 2)
            : undefined
        }
      />

      {/* Forced delineation type selection — shown when user switches Delineation Not Present→Present */}
      <PresentMultiTagModal
        open={pendingPresentDelineationChange}
        title="Select Delineation Type"
        description='Delineation was set to "Present". Please select the type(s) that apply:'
        options={presentDelineationTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("Delineation Type", val);
          setPendingPresentDelineationChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingNotPresentDelineationChange}
        singleSelect
        title="Set Delineation Condition"
        description='Delineation was set to "Not Present". Is it Absent or In Poor Condition?'
        options={["Absent", "In Poor Condition"]}
        onConfirm={(val) => {
          editCurrentAttr("Delineation Type", val);
          setPendingNotPresentDelineationChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentFOChange}
        title="Select FO Type"
        description='Fixed Obstacle was set to "Present". Please select the type(s) that apply:'
        options={foTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("FO Type", val);
          setPendingPresentFOChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentNFOChange}
        title="Select NFO Type"
        description='Non-Fixed Obstacle was set to "Present". Please select the type(s) that apply:'
        options={nfoTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("NFO Type", val);
          setPendingPresentNFOChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentSlipperyChange}
        title="Select Issue Type (Slippery)"
        description='"Loose or slippery surface" was set to "Present". Please select the issue type(s) that apply:'
        options={slipperyIssueTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("Issue Type (Slippery)", val);
          setPendingPresentSlipperyChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentDefectChange}
        title="Select Defect Type"
        description='"Major Surface Deformation or Drain Opening" was set to "Present". Please select the defect type(s) that apply:'
        options={defectTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("Defect Type", val);
          setPendingPresentDefectChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingFacilityWidthParentChange !== null}
        singleSelect
        title="Select Facility Width Sub-category"
        description={`Facility Width was set to "${pendingFacilityWidthParentChange?.categoryLabel}". Please select the specific sub-category:`}
        options={pendingFacilityWidthParentChange?.subCategories ?? []}
        onConfirm={(val) => {
          editCurrentAttrMany({ "Facility Width Sub-category": val });
          setPendingFacilityWidthParentChange(null);
        }}
        onCancel={() => {
          if (pendingFacilityWidthParentChange) {
            editCurrentAttrMany({
              "Facility Width per Direction": pendingFacilityWidthParentChange.originalParentCode,
              "Facility Width Sub-category": pendingFacilityWidthParentChange.originalSubCategory,
            });
          }
          setPendingFacilityWidthParentChange(null);
        }}
      />
    </>
  );
}
