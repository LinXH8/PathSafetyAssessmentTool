import {
  Badge,
  Box,
  Button,
  Card,
  CardHeader,
  CardBody,
  Heading,
  Input,
  Text,
  Combobox,
  createListCollection,
  Separator,
} from "@chakra-ui/react";
import ImageUploadModal from "../../sidebar/components/ImageUploadModal";
import SelectRoadsMap from "../SelectRoadsMap";
import type { CreateProjectViewModel } from "./CreateProjectViewModel";
import "../../Projects/components/EditProjectModal.css";

// Generate a consistent, bright, varied color for each unique tag (same as EditProjectModal)
function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hash2 = Math.abs(hash >> 16);
  const hash3 = Math.abs(hash << 3);

  let hue = Math.abs(hash % 360);
  if (hue >= 40 && hue <= 60) hue = (hue + 30) % 360;
  if (hue >= 160 && hue <= 180) hue = (hue + 30) % 360;

  const saturation = 75 + (hash2 % 21);
  const lightness = 65 + (hash3 % 16);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function formatCaptureDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toLocaleDateString(undefined, options ?? {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * v1 Create Project layout — the current arrangement extracted verbatim from
 * createProjectPage.tsx, now driven by the CreateProjectViewModel. No redesign.
 */
export default function CreateProjectLayoutV1(vm: CreateProjectViewModel) {
  const {
    name,
    setName,
    tags,
    tagInput,
    setTagInput,
    tagSuggestionsOpen,
    setTagSuggestionsOpen,
    filteredTagSuggestions,
    commitTag,
    removeTag,
    handleTagInputKeyDown,
    folders,
    folder,
    setFolder,
    folderComboboxOpen,
    setFolderComboboxOpen,
    loadingFolders,
    selectedFolderExists,
    folderPreview,
    loadingFolderPreview,
    folderPreviewError,
    usingRoadSelection,
    selectedRoadFolders,
    unavailableSelectedRoads,
    roadAvailabilityVersion,
    onRoadSelectionChange,
    onSelectionGeometryChange,
    err,
    canCreate,
    creating,
    onCreate,
    onCancel,
    imageUploadModalOpen,
    openImageUploadModal,
    closeImageUploadModal,
    onImageUploadSuccess,
  } = vm;

  return (
    <Box p={4} maxW="900px" mx="auto">
      <Card.Root>
        <CardHeader>
          <Heading size="md">Create Project from Folder</Heading>
          <Text mt="1" color="gray.500" fontSize="sm">
            Use either a single source folder or a geometry-selected set of roads to create a project.
          </Text>
        </CardHeader>
        <CardBody display="grid" gap={4}>
          <Box>
            <Text fontSize="sm" mb={1}>
              Project Name
            </Text>
            <Input
              placeholder="No underscore _"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {name.includes("_") && (
              <Text color="red.600" _dark={{ color: "red.400" }} fontSize="xs" mt={1}>
                Project name cannot contain underscores (_)
              </Text>
            )}
          </Box>

          <Box>
            <Text fontSize="sm" mb={1}>
              Tags (optional)
            </Text>
            <Box className="tag-input-container">
              <Box className="tag-input-wrapper">
                {tags.map((tag) => (
                  <Box
                    key={tag}
                    className="tag-chip"
                    style={{
                      backgroundColor: getTagColor(tag),
                    }}
                  >
                    <span className="tag-chip-text">{tag}</span>
                    <button
                      className="tag-chip-remove"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </Box>
                ))}
                <Box position="relative" flex="1" minW="160px">
                  <Input
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setTagSuggestionsOpen(true);
                    }}
                    onFocus={() => setTagSuggestionsOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setTagSuggestionsOpen(false), 100);
                    }}
                    placeholder="Type tag and press comma or enter"
                    className="tag-input-field"
                    onKeyDown={handleTagInputKeyDown}
                  />
                  {tagSuggestionsOpen && filteredTagSuggestions.length > 0 && (
                    <Box
                      position="absolute"
                      top="calc(100% + 8px)"
                      left="0"
                      right="0"
                      bg="white"
                      borderWidth="1px"
                      borderColor="gray.200"
                      _dark={{ borderColor: "gray.700", bg: "gray.800" }}
                      borderRadius="md"
                      boxShadow="md"
                      maxH="180px"
                      overflowY="auto"
                      zIndex={1200}
                    >
                      {filteredTagSuggestions.map((tag) => (
                        <Button
                          key={tag}
                          type="button"
                          display="block"
                          width="100%"
                          px="3"
                          py="2"
                          textAlign="left"
                          fontSize="sm"
                          variant="ghost"
                          justifyContent="flex-start"
                          borderRadius="0"
                          minH="auto"
                          h="auto"
                          _hover={{ bg: "gray.50", _dark: { bg: "gray.700" } }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commitTag(tag);
                          }}
                        >
                          {tag}
                        </Button>
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
            <Text color="gray.500" fontSize="xs" mt={1}>
              Press comma (,) or Enter to add a tag. Click a suggestion or type to select existing tags.
            </Text>
          </Box>

          <Box>
            <Text fontSize="sm" mb={1}>
              Source Folder
            </Text>

            <Box display="flex" gap={2} alignItems="flex-end">
              <Box flex={1}>
                <Combobox.Root
                  collection={createListCollection({
                    items: folders.map(f => ({ label: f, value: f }))
                  })}
                  inputValue={folder}
                  onInputValueChange={({ inputValue }) => setFolder(inputValue)}
                  onValueChange={({ value }) => {
                    if (value.length > 0) {
                      setFolder(value[0]);
                      setFolderComboboxOpen(false);
                    }
                  }}
                  disabled={loadingFolders}
                  open={folderComboboxOpen}
                  onOpenChange={(details) => setFolderComboboxOpen(details.open)}
                >
                  <Combobox.Control onClick={() => setFolderComboboxOpen(true)}>
                    <Combobox.Input
                      placeholder={loadingFolders ? "Loading..." : "Select a folder"}
                    />
                  </Combobox.Control>
                  <Combobox.Positioner zIndex={1200}>
                    <Combobox.Content>
                      {folders
                        .filter(f => f.toLowerCase().includes(folder.toLowerCase()))
                        .map(f => (
                          <Combobox.Item key={f} item={{ label: f, value: f }}>
                            {f}
                          </Combobox.Item>
                        ))}
                    </Combobox.Content>
                  </Combobox.Positioner>
                </Combobox.Root>
              </Box>
              <Button
                colorPalette="green"
                variant="surface"
                size="sm"
                onClick={openImageUploadModal}
              >
                Import Folder
              </Button>
            </Box>

            {err && (
              <Text color="red.600" _dark={{ color: "red.400" }} fontSize="xs" mt={1}>
                {err}
              </Text>
            )}

            {!usingRoadSelection && (
              <Text color="gray.500" fontSize="xs" mt={1}>
                This is used when no roads are selected from the polygon map.
              </Text>
            )}

            {selectedFolderExists && (
              <Box mt={3} border="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.700", bg: "gray.800" }} borderRadius="md" p={3} bg="gray.50">
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3} flexWrap="wrap" mb={2}>
                  <Box>
                    <Text fontSize="sm" fontWeight="semibold">
                      {folder} Summary
                    </Text>
                    {folderPreview && (
                      <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                        {folderPreview.image_count} image{folderPreview.image_count === 1 ? "" : "s"} in this source folder
                      </Text>
                    )}
                  </Box>
                  {folderPreview && folderPreview.survey_quarters.length > 0 && (
                    <Box display="flex" gap={2} flexWrap="wrap">
                      {folderPreview.survey_quarters.map((quarter) => (
                        <Badge key={quarter} colorPalette="blue" size="sm">
                          {quarter}
                        </Badge>
                      ))}
                    </Box>
                  )}
                </Box>

                {loadingFolderPreview && (
                  <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                    Loading folder summary...
                  </Text>
                )}

                {folderPreviewError && !loadingFolderPreview && (
                  <Text fontSize="xs" color="red.600" _dark={{ color: "red.400" }}>
                    {folderPreviewError}
                  </Text>
                )}

                {folderPreview && !loadingFolderPreview && !folderPreviewError && (
                  <>
                    <Text fontSize="xs" color="gray.600" _dark={{ color: "gray.400" }} mb={3}>
                      Survey quarter is inferred from the last modified timestamp on the images in this folder, not from EXIF metadata. This summary is cached inside the folder and refreshes automatically when the image set changes.
                    </Text>

                    {folderPreview.renamed_from && (
                      <Text fontSize="xs" color="blue.600" _dark={{ color: "blue.400" }} mb={3}>
                        Renamed from {folderPreview.renamed_from} to {folderPreview.folder_name} to include the detected survey quarter.
                      </Text>
                    )}

                    {folderPreview.mixed_quarters && (
                      <Text fontSize="xs" color="orange.600" _dark={{ color: "orange.400" }} mb={3}>
                        This folder spans multiple survey quarters ({folderPreview.survey_quarters.join(", ")}). Keep quarters separated where possible so project creation stays predictable.
                      </Text>
                    )}

                    {folderPreview.cached && !folderPreview.renamed_from && (
                      <Text fontSize="xs" color="green.600" _dark={{ color: "green.400" }} mb={3}>
                        Loaded instantly from cached folder metadata.
                      </Text>
                    )}

                    <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap={3}>
                      <Box border="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600", bg: "gray.700" }} borderRadius="md" bg="white" p={3}>
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }} mb={1}>Segments</Text>
                        <Text fontSize="lg" fontWeight="semibold">
                          {folderPreview.segment_count}
                        </Text>
                      </Box>

                      <Box border="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600", bg: "gray.700" }} borderRadius="md" bg="white" p={3}>
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }} mb={1}>Survey Quarter</Text>
                        <Text fontSize="lg" fontWeight="semibold">
                          {folderPreview.survey_quarter ?? (folderPreview.survey_quarters.length > 0 ? folderPreview.survey_quarters.join(", ") : "Unknown")}
                        </Text>
                      </Box>

                      <Box border="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600", bg: "gray.700" }} borderRadius="md" bg="white" p={3}>
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }} mb={1}>Source Images</Text>
                        <Text fontSize="lg" fontWeight="semibold">
                          {folderPreview.image_count}
                        </Text>
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }} mt={1}>
                          {folderPreview.geotagged_image_count} geotagged
                        </Text>
                      </Box>

                      <Box border="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600", bg: "gray.700" }} borderRadius="md" bg="white" p={3}>
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }} mb={1}>Last Modified</Text>
                        <Text fontSize="sm" fontWeight="semibold">
                          {folderPreview.earliest_modified_at && folderPreview.latest_modified_at
                            ? folderPreview.earliest_modified_at === folderPreview.latest_modified_at
                              ? formatCaptureDate(folderPreview.latest_modified_at) ?? "Unknown"
                              : `${formatCaptureDate(folderPreview.earliest_modified_at) ?? "Unknown"} to ${formatCaptureDate(folderPreview.latest_modified_at) ?? "Unknown"}`
                            : "Unknown"}
                        </Text>
                      </Box>
                    </Box>

                    {folderPreview.segment_error && (
                      <Text fontSize="xs" color="orange.600" _dark={{ color: "orange.400" }} mt={3}>
                        Segment summary fallback: {folderPreview.segment_error}
                      </Text>
                    )}
                  </>
                )}
              </Box>
            )}
          </Box>

          <Separator />

          <Box>
            <Text fontSize="sm" fontWeight="medium" mb={2}>
              Select Roads
            </Text>
            <Text color="gray.500" fontSize="xs" mb={3}>
              Draw a polygon, click a planning area, or import polygon or line shapefiles to select multiple roads. Project creation keeps only nodes inside the selected area, or near imported path lines.
            </Text>
            <SelectRoadsMap
              onSelectionChange={onRoadSelectionChange}
              onSelectionGeometryChange={onSelectionGeometryChange}
              refreshKey={roadAvailabilityVersion}
              focusRoadName={selectedFolderExists ? folder.trim() : ""}
            />

            {usingRoadSelection && unavailableSelectedRoads.length > 0 && (
              <Text color="orange.600" _dark={{ color: "orange.400" }} fontSize="xs" mt={3}>
                Deselect unavailable roads to create the project. {unavailableSelectedRoads.length} selected road{unavailableSelectedRoads.length === 1 ? " is" : "s are"} missing local files. Use the map list's Deselect Unavailable action to clear them in one click.
              </Text>
            )}

            {usingRoadSelection && unavailableSelectedRoads.length === 0 && (
              <Text color="green.600" _dark={{ color: "green.400" }} fontSize="xs" mt={3}>
                Project will be created from nodes inside the boundary across {selectedRoadFolders.length} selected road{selectedRoadFolders.length === 1 ? "" : "s"}.
              </Text>
            )}
          </Box>

          <Box display="flex" gap={3}>
            <Button
              variant="solid"
              onClick={onCreate}
              disabled={!canCreate || creating}
              loading={creating}
            >
              Create
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </Box>
        </CardBody>
      </Card.Root>

      <ImageUploadModal
        open={imageUploadModalOpen}
        onClose={closeImageUploadModal}
        onSuccess={onImageUploadSuccess}
      />
    </Box>
  );
}
