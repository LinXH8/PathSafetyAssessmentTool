import { useState, useEffect, type KeyboardEvent } from "react";
import {
  Box,
  Button,
  Dialog,
  Portal,
  Input,
  Text,
  CloseButton,
  Separator,
} from "@chakra-ui/react";
import { toaster } from "../../../components/ui/toaster";
import * as api from "../../../api";

interface FacilityWidthConfirm {
  oldSubCategory: string | null;
  oldCategory: string | null;
  getNewCategory: (tag: string) => string | null;
}

interface AttributeOptionsDialogProps {
  open: boolean;
  onClose: () => void;
  fieldName: string;
  currentValue?: string | null;
  onSetValue?: (value: string | null) => void;
  options: string[]; // all unique values across the project (for "Add New" suggestions)
  onSave: (field: string, options: string[]) => void;
  delineationNotPresent?: boolean; // when true, restrict options to "Absent"/"In Poor Condition" with single-select
  onSetParentNotPresent?: () => void; // when provided and user confirms with zero tags, show confirmation
  /** When true only 1 tag may be held at a time (new selection replaces existing) */
  singleSelect?: boolean;
  /** When provided, show a category-change confirmation before saving */
  facilityWidthConfirm?: FacilityWidthConfirm;
}

const FIELD_CURRENT_LABEL: Record<string, string> = {
  "FO Type": "Fixed Obstacle in this segment",
  "NFO Type": "Non-Fixed Obstacle in this segment",
  "Facility Width Sub-category": "Facility Width Sub-category for this segment",
  "Issue Type (Slippery)": "Slippery issue in this segment",
  "Crossing Type": "Crossing type for this segment",
  "Curvature Sub-category": "Curvature sub-category for this segment",
};

const FIELD_ADD_LABEL: Record<string, string> = {
  "FO Type": "Add Fixed Obstacle",
  "NFO Type": "Add Non-Fixed Obstacle",
  "Facility Width Sub-category": "Select Facility Width Sub-category",
  "Issue Type (Slippery)": "Add Issue Type",
  "Crossing Type": "Add Crossing Type",
  "Curvature Sub-category": "Select Curvature Sub-category",
};

const FIELD_PARENT_LABEL: Record<string, string> = {
  "FO Type": "Fixed Obstacle",
  "NFO Type": "Non-Fixed Obstacle",
  "Delineation Type": "Delineation",
  "Issue Type (Slippery)": "Loose or slippery surface",
  "Crossing Type": "Crossing Facility",
};

/** Override the first sentence of the empty-confirm prompt; fallback uses template */
const FIELD_EMPTY_CONFIRM_BODY: Record<string, string> = {
  "Issue Type (Slippery)": "No issues have been set.",
  "Crossing Type": "No crossing types are set.",
};

const FIELD_SUGGESTIONS: Record<string, string[]> = {
  "FO Type": ["Lamp Post", "Traffic Light", "Pillar", "Bollards", "Fence", "Vegetation"],
  "NFO Type": ["Barrier", "Bins", "Bicycle", "Cone"],
  "Issue Type (Slippery)": ["Algae", "Leaves", "Soil", "Sand"],
  "Facility Width Sub-category": ["≤1.5m", ">1.5–1.8m", ">1.8–<2m", "2–<3.5m", "3.5–4m", ">4m"],
  "Crossing Type": ["Bicycle Crossing", "Signalised Crossing", "Zebra Crossing"],
  "Delineation Type": ["Cycling Path", "Red Stripe", "Signalised Crossing", "Zebra Crossing"],
  "Curvature Sub-category": ["<6.5m", "<10m", "Path Junction", "10–18m", ">18m"],
};

/** Parse a comma-separated value string into an array of trimmed, non-empty tags */
function parseTags(value: string | null | undefined): string[] {
  if (!value || value.trim() === "") return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

/** Join tags back to a comma-separated string, or null if empty */
function joinTags(tags: string[]): string | null {
  return tags.length > 0 ? tags.join(", ") : null;
}

const NOT_PRESENT_OPTIONS = ["Absent", "In Poor Condition"] as const;

export default function AttributeOptionsDialog({
  open,
  onClose,
  fieldName,
  currentValue,
  onSetValue,
  options,
  onSave,
  delineationNotPresent = false,
  onSetParentNotPresent,
  singleSelect = false,
  facilityWidthConfirm,
}: AttributeOptionsDialogProps) {
  const [localTags, setLocalTags] = useState<string[]>(parseTags(currentValue));
  const [othersText, setOthersText] = useState("");
  const [showOthersInput, setShowOthersInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  // Facility Width category-change confirmation
  const [showFWConfirm, setShowFWConfirm] = useState(false);
  const [pendingFWTag, setPendingFWTag] = useState<string | null>(null);

  // Sync state when dialog opens
  useEffect(() => {
    if (open) {
      setLocalTags(parseTags(currentValue));
      setOthersText("");
      setShowOthersInput(false);
      setShowEmptyConfirm(false);
      setShowFWConfirm(false);
      setPendingFWTag(null);
    }
  }, [open, currentValue]);

  // Scroll-lock cleanup on close (matches CLAUDE.md documented fix)
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

  // When delineation is Not Present, restrict options to the two condition values and force single-select
  const effectiveSingleSelect = singleSelect || delineationNotPresent;
  const predefined = delineationNotPresent
    ? [...NOT_PRESENT_OPTIONS]
    : (FIELD_SUGGESTIONS[fieldName] ?? []);
  const allChoices = [...predefined].sort();
  // Filter out values already in tags
  const availableChoices = allChoices.filter((c) => !localTags.includes(c));

  function addTag(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (effectiveSingleSelect) {
      setLocalTags([trimmed]);
    } else if (!localTags.includes(trimmed)) {
      setLocalTags((prev) => [...prev, trimmed]);
    }
    setOthersText("");
    setShowOthersInput(false);
  }

  function handleRemoveTag(tag: string) {
    setLocalTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleOthersKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(othersText);
    }
  }

  /** Shared helper: persist any newly added options to the backend, returns false on failure */
  async function persistNewOptions(): Promise<boolean> {
    const newlyAdded = localTags.filter((t) => !options.includes(t));
    if (newlyAdded.length === 0) return true;
    try {
      setSaving(true);
      await api.updateCustomAttrOptions(fieldName, newlyAdded);
      onSave(fieldName, newlyAdded);
      return true;
    } catch (err: any) {
      toaster.create({ title: "Save Failed", description: err?.message || "Failed to save options", type: "error" });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    // Guard: if all tags removed and parent callback provided, prompt instead of saving null
    if (!delineationNotPresent && localTags.length === 0 && onSetParentNotPresent) {
      setShowEmptyConfirm(true);
      return;
    }

    // Facility Width category-change confirmation
    if (singleSelect && facilityWidthConfirm && localTags.length === 1) {
      const newTag = localTags[0];
      const newCat = facilityWidthConfirm.getNewCategory(newTag);
      if (
        newCat &&
        facilityWidthConfirm.oldCategory &&
        newCat !== facilityWidthConfirm.oldCategory
      ) {
        setPendingFWTag(newTag);
        setShowFWConfirm(true);
        return;
      }
    }

    if (!(await persistNewOptions())) return;
    onSetValue?.(joinTags(localTags));
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(d) => !d.open && onClose()} unmountOnExit>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="420px" w="full">
            <Dialog.Header>
              <Dialog.Title>Edit Options: {fieldName}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              {showEmptyConfirm ? (
                /* Confirmation prompt when all tags are removed */
                <Box display="flex" flexDirection="column" gap="4">
                  <Text>
                    {FIELD_EMPTY_CONFIRM_BODY[fieldName] ??
                      `No ${FIELD_PARENT_LABEL[fieldName] ?? fieldName} types are selected.`}{" "}
                    Set <strong>{FIELD_PARENT_LABEL[fieldName] ?? fieldName}</strong> to{" "}
                    <strong>Not Present</strong>?
                  </Text>
                  <Box display="flex" gap="3" justifyContent="flex-end">
                    <Button variant="outline" onClick={() => setShowEmptyConfirm(false)}>
                      No
                    </Button>
                    <Button
                      colorPalette="blue"
                      onClick={() => {
                        onSetParentNotPresent!();
                        onClose();
                      }}
                    >
                      Yes
                    </Button>
                  </Box>
                </Box>
              ) : showFWConfirm ? (
                /* Facility Width category-change confirmation */
                <Box display="flex" flexDirection="column" gap="4">
                  <Text>
                    Setting <strong>{facilityWidthConfirm!.oldSubCategory ?? "(none)"}</strong> to{" "}
                    <strong>{pendingFWTag}</strong> will change the facility width from{" "}
                    <strong>{facilityWidthConfirm!.oldCategory}</strong> to{" "}
                    <strong>{facilityWidthConfirm!.getNewCategory(pendingFWTag!)}</strong>.
                  </Text>
                  <Box display="flex" gap="3" justifyContent="flex-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Revert to old tag, stay open
                        setLocalTags(
                          facilityWidthConfirm!.oldSubCategory
                            ? [facilityWidthConfirm!.oldSubCategory]
                            : []
                        );
                        setShowFWConfirm(false);
                        setPendingFWTag(null);
                      }}
                    >
                      No
                    </Button>
                    <Button
                      colorPalette="blue"
                      loading={saving}
                      onClick={async () => {
                        setShowFWConfirm(false);
                        if (!(await persistNewOptions())) return;
                        onSetValue?.(pendingFWTag);
                        onClose();
                      }}
                    >
                      Yes
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Box display="flex" flexDirection="column" gap="3">

                  {/* Tags — current values for this segment */}
                  <Box display="flex" flexDirection="column" gap="2">
                    <Text fontSize="xs" fontWeight="semibold" color="gray.600" _dark={{ color: "gray.400" }}>
                      {FIELD_CURRENT_LABEL[fieldName] ?? "Delineation Type(s) for this segment"}
                    </Text>

                    <Box
                      display="flex"
                      flexWrap="wrap"
                      gap="1.5"
                      minH="36px"
                      p="2"
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor="gray.200"
                      bg="gray.50"
                      _dark={{ bg: "gray.800", borderColor: "gray.600" }}
                    >
                      {localTags.length === 0 && (
                        <Text fontSize="sm" color="gray.400" lineHeight="1.8">
                          No values — add one below
                        </Text>
                      )}
                      {localTags.map((tag) => (
                        <Box
                          key={tag}
                          display="inline-flex"
                          alignItems="center"
                          gap="1"
                          px="2"
                          py="0.5"
                          borderRadius="full"
                          bg="blue.100"
                          color="blue.800"
                          _dark={{ bg: "blue.800", color: "blue.100" }}
                          fontSize="xs"
                          fontWeight="medium"
                        >
                          <Text as="span">{tag}</Text>
                          <Box
                            as="button"
                            onClick={() => handleRemoveTag(tag)}
                            aria-label={`Remove ${tag}`}
                            display="inline-flex"
                            alignItems="center"
                            justifyContent="center"
                            w="14px"
                            h="14px"
                            borderRadius="full"
                            _hover={{ bg: "blue.200", _dark: { bg: "blue.700" } }}
                            cursor="pointer"
                            border="none"
                            background="none"
                            color="inherit"
                            fontSize="10px"
                            lineHeight={1}
                            ml="0.5"
                          >
                            ✕
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>

                  <Separator />

                  {/* Add New */}
                  <Box display="flex" flexDirection="column" gap="2">
                    <Text fontSize="xs" fontWeight="semibold" color="gray.600" _dark={{ color: "gray.400" }}>
                      {FIELD_ADD_LABEL[fieldName] ?? "Add New Delineation Type"}
                    </Text>

                    <Box display="flex" flexWrap="wrap" gap="2">
                      {availableChoices.map((choice) => (
                        <Box
                          key={choice}
                          as="button"
                          px="3"
                          py="1.5"
                          borderRadius="full"
                          borderWidth="2px"
                          borderColor="gray.200"
                          bg="white"
                          color="gray.700"
                          fontSize="sm"
                          cursor="pointer"
                          _hover={{ borderColor: "blue.400", bg: "blue.50" }}
                          _dark={{ bg: "gray.800", borderColor: "gray.600", color: "gray.300" }}
                          transition="all 0.15s"
                          onClick={() => addTag(choice)}
                        >
                          {choice}
                        </Box>
                      ))}
                      {!effectiveSingleSelect && (
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
                      {availableChoices.length === 0 && effectiveSingleSelect && (
                        <Text fontSize="sm" color="gray.400">No more options to add</Text>
                      )}
                    </Box>

                    {showOthersInput && (
                      <Box display="flex" gap="2" mt="1">
                        <Input
                          size="sm"
                          placeholder="Enter custom value..."
                          value={othersText}
                          onChange={(e) => setOthersText(e.target.value)}
                          onKeyDown={handleOthersKeyDown}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => addTag(othersText)}
                          disabled={!othersText.trim()}
                        >
                          Add
                        </Button>
                      </Box>
                    )}
                  </Box>

                </Box>
              )}
            </Dialog.Body>

            {!showEmptyConfirm && !showFWConfirm && (
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={saving}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="blue" onClick={handleSave} loading={saving}>
                  Confirm
                </Button>
              </Dialog.Footer>
            )}

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" position="absolute" top="3" right="3" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
