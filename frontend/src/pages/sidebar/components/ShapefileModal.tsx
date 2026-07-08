import { useState, useEffect, useRef, useMemo } from "react";
import { Box, Button, Text, Dialog, Portal, Input, Checkbox } from "@chakra-ui/react";
import { LuPlus, LuRefreshCw, LuUpload, LuFile, LuX, LuFolderInput, LuCheck } from "react-icons/lu";
import { toaster } from "../../../components/ui/toaster";
import * as api from "../../../api";
import "../../ShapefileManagement/shapefileManagement.css";
import "../../ShapefileManagement/shapefileManagement-v2.css";
import { MapContainer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ThemeAwareTileLayer from "../../../components/common/ThemeAwareTileLayer";
import { Spinner } from "@chakra-ui/react";

function FitBoundsGeoJSON({ data }: { data: any }) {
  const map = useMap();
  useEffect(() => {
    if (data) {
      try {
        const layer = L.geoJSON(data);
        const bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
      } catch (_) {}
    }
  }, [data, map]);
  return null;
}

interface ShapefileModalProps {
  open: boolean;
  onClose: () => void;
  /** v1 stays byte-identical (default); v2 applies DESIGN_GUIDE.md tokens only — no structural change. */
  variant?: "v1" | "v2";
}

type WorkflowStep = "choice" | "add" | "replace" | "success";

// Preferred display order for Affects categories (API response key order isn't guaranteed).
const AFFECTS_CATEGORY_ORDER = ["For Auto Coding", "For Area Based Reports", "For Analysis"];

export default function ShapefileModal({ open, onClose, variant = "v1" }: ShapefileModalProps) {
  const v2 = variant === "v2";
  const v2ModalClass = v2 ? "psat-shapefile-modal--v2" : "";
  const [step, setStep] = useState<WorkflowStep>("choice");
  const [allShapefiles, setAllShapefiles] = useState<api.ShapefileInfo[]>([]);

  // Add Shapefile State
  const [selectedCategory, setSelectedCategory] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add Shapefile State — Required Columns (optional) / Affects (mandatory; pick a
  // category first, then attributes within it — stored as "Category: Attribute")
  const [addRequiredColumns, setAddRequiredColumns] = useState("");
  const [addAffectsSelected, setAddAffectsSelected] = useState<Set<string>>(new Set());
  const [addCustomAffect, setAddCustomAffect] = useState("");
  const [addParameterGroups, setAddParameterGroups] = useState<api.ParameterOptionGroups>({});
  const [addActiveAffectsCategory, setAddActiveAffectsCategory] = useState("");

  const addAffectsCategoryNames = [
    ...AFFECTS_CATEGORY_ORDER.filter((name) => name in addParameterGroups),
    ...Object.keys(addParameterGroups).filter((name) => !AFFECTS_CATEGORY_ORDER.includes(name)),
  ];

  function resetAddMetadataState() {
    setAddRequiredColumns("");
    setAddAffectsSelected(new Set());
    setAddCustomAffect("");
  }

  function affectsKey(category: string, param: string) {
    return `${category}: ${param}`;
  }

  function toggleAddAffect(category: string, param: string) {
    const key = affectsKey(category, param);
    setAddAffectsSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function removeAddAffect(key: string) {
    setAddAffectsSelected(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function addCustomAffectParam() {
    const trimmed = addCustomAffect.trim();
    if (!trimmed || !addActiveAffectsCategory) return;
    setAddAffectsSelected(prev => new Set(prev).add(affectsKey(addActiveAffectsCategory, trimmed)));
    setAddCustomAffect("");
  }

  // Custom (not in the known list) attributes already selected under the active category.
  const addCustomAffectsForActiveCategory = Array.from(addAffectsSelected)
    .filter((k) => k.startsWith(`${addActiveAffectsCategory}: `))
    .map((k) => k.slice(addActiveAffectsCategory.length + 2))
    .filter((opt) => !(addParameterGroups[addActiveAffectsCategory] || []).includes(opt));

  // Replace Shapefile State
  const [replaceFiles, setReplaceFiles] = useState<File[]>([]);
  const [selectedTargetShapefile, setSelectedTargetShapefile] = useState<string>("");
  const [replacing, setReplacing] = useState(false);
  const [replaceDragActive, setReplaceDragActive] = useState(false);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const [targetShapefileSearch, setTargetShapefileSearch] = useState("");
  const [isTargetDropdownOpen, setIsTargetDropdownOpen] = useState(false);
  const targetSearchRef = useRef<HTMLDivElement>(null);
  const previewRequestIdRef = useRef(0);

  // Preview state (Add screen)
  const [previewGeoJSON, setPreviewGeoJSON] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  function resetPreviewState() {
    previewRequestIdRef.current += 1;
    setPreviewGeoJSON(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  useEffect(() => {
    if (open) {
      loadAllShapefiles();
      api.getParameterOptions().then((groups) => {
        setAddParameterGroups(groups);
        const ordered = AFFECTS_CATEGORY_ORDER.filter((name) => name in groups);
        const first = ordered[0] || Object.keys(groups)[0] || "";
        setAddActiveAffectsCategory(first);
      }).catch(() => setAddParameterGroups({}));
    }
  }, [open]);

  async function loadAllShapefiles() {
    try {
      const data = await api.listShapefiles();
      setAllShapefiles(data);
    } catch (error) {
    }
  }

  function resetState() {
    setStep("choice");
    setUploadFiles([]);
    setReplaceFiles([]);
    setSelectedCategory("__new__");
    setSelectedTargetShapefile("");
    setDragActive(false);
    resetPreviewState();
    setTargetShapefileSearch("");
    setNewCategoryName("");
    resetAddMetadataState();
  }

  async function fetchPreview(files: File[]) {
    const hasShp = files.some(f => f.name.toLowerCase().endsWith(".shp"));
    const hasZip = files.some(f => f.name.toLowerCase().endsWith(".zip"));
    if (!hasShp && !hasZip) {
      resetPreviewState();
      return;
    }

    const requestId = ++previewRequestIdRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewGeoJSON(null);
    try {
      const geojson = await api.previewUploadedShapefiles(files);
      if (previewRequestIdRef.current !== requestId) {
        return;
      }
      if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
        throw new Error("Invalid preview response");
      }
      setPreviewGeoJSON(geojson);
    } catch (e: any) {
      if (previewRequestIdRef.current !== requestId) {
        return;
      }
      setPreviewError(e.message || "Preview failed");
    } finally {
      if (previewRequestIdRef.current === requestId) {
        setPreviewLoading(false);
      }
    }
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function handleChoiceSelect(choice: "add" | "replace") {
    setStep(choice);
    if (choice === "add") {
      setSelectedCategory("__new__");
    }
  }

  function handleBackToChoice() {
    setStep("choice");
    // Clear state
    setUploadFiles([]);
    setReplaceFiles([]);
    setSelectedTargetShapefile("");
    setTargetShapefileSearch("");
    resetPreviewState();
  }

  const filteredTargetShapefiles = useMemo(() => {
    const gisLayerExtensions = ['.shp', '.geojson', '.kml', '.kmz', '.gml', '.gpx', '.json'];
    const baseList = allShapefiles.filter(shp => {
      const fileName = (shp.filename || "").toLowerCase();
      return gisLayerExtensions.some(ext => fileName.endsWith(ext));
    });

    if (!targetShapefileSearch) return baseList;
    const query = targetShapefileSearch.toLowerCase();
    return baseList.filter(shp => 
      shp.name.toLowerCase().includes(query) || 
      shp.category.toLowerCase().includes(query)
    );
  }, [allShapefiles, targetShapefileSearch]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (targetSearchRef.current && !targetSearchRef.current.contains(event.target as Node)) {
        setIsTargetDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // === Add Shapefile Functions ===

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      addFiles(selectedFiles);
    }
  }

  function addFiles(newFiles: File[]) {
    // Accept ZIP files (containing shapefile components) AND individual GIS files
    const gisExtensions = ['.zip', '.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx',
      '.geojson', '.kml', '.kmz', '.gml', '.gpx', '.json'];

    const validFiles = newFiles.filter((f) => {
      const fileName = f.name.toLowerCase();
      return gisExtensions.some(ext => fileName.endsWith(ext));
    });

    if (validFiles.length === 0) {
      toaster.create({
        description: "Please upload a ZIP file containing shapefile components, or individual GIS files (.shp + companions, .geojson, .kml, .gpx, etc.).",
        type: "warning",
      });
      return;
    }

    const merged = [...uploadFiles, ...validFiles];
    setUploadFiles(merged);
    fetchPreview(merged);
  }

  function removeFile(index: number) {
    const updated = uploadFiles.filter((_, i) => i !== index);
    setUploadFiles(updated);
    if (updated.length > 0) fetchPreview(updated);
    else resetPreviewState();
  }

  async function handleAddUpload() {
    let categoryToUse = selectedCategory === "__new__" ? newCategoryName : selectedCategory;
    if (!categoryToUse || categoryToUse.trim() === "") {
      categoryToUse = "uncategorised";
    }

    if (uploadFiles.length === 0) {
      toaster.create({
        description: "Please select files to upload",
        type: "warning",
      });
      return;
    }

    const requiredColumnsTrimmed = addRequiredColumns.trim();
    if (addAffectsSelected.size === 0) {
      toaster.create({
        description: "Select at least one Affects parameter for the new GIS layer",
        type: "warning",
      });
      return;
    }

    try {
      setUploading(true);
      const result = await api.uploadShapefiles(uploadFiles, categoryToUse);

      if (result.errors.length > 0) {
        toaster.create({
          description: `Uploaded ${result.count} file(s) with ${result.errors.length} error(s)`,
          type: "warning",
        });
      } else {
        toaster.create({
          description: `Successfully uploaded ${result.count} shapefile(s)`,
          type: "success",
        });
      }

      if (result.uploaded.length > 0) {
        const affectsList = Array.from(addAffectsSelected);
        await Promise.all(
          result.uploaded.map((item) =>
            api.setLayerMetadata(item.path, requiredColumnsTrimmed, affectsList).catch(() => {
              toaster.create({
                description: `Could not save Required Columns / Affects for ${item.name}`,
                type: "warning",
              });
            })
          )
        );
      }

      // Clear files and reload data
      setUploadFiles([]);
      resetPreviewState();
      resetAddMetadataState();
      await loadAllShapefiles();
      setStep("success");
    } catch (error) {
      toaster.create({
        description: `Upload failed: ${error}`,
        type: "error",
      });
    } finally {
      setUploading(false);
    }
  }

  // === Replace Shapefile Functions ===

  function handleReplaceDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setReplaceDragActive(true);
  }

  function handleReplaceDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setReplaceDragActive(false);
  }

  function handleReplaceDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleReplaceDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setReplaceDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      validateAndSetReplaceFiles(droppedFiles);
    }
  }

  function handleReplaceFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      validateAndSetReplaceFiles(selectedFiles);
    }
  }

  function validateAndSetReplaceFiles(files: File[]) {
    // Accept ZIP files (containing shapefile components) AND individual GIS files
    const gisExtensions = ['.zip', '.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx',
      '.geojson', '.kml', '.kmz', '.gml', '.gpx', '.json'];

    const invalidFiles = files.filter(f => {
      const fileName = f.name.toLowerCase();
      return !gisExtensions.some(ext => fileName.endsWith(ext));
    });

    if (invalidFiles.length > 0) {
      toaster.create({
        description: `Invalid file(s): ${invalidFiles.map(f => f.name).join(', ')}. Please upload a ZIP file containing shapefile components, or individual GIS files.`,
        type: "warning",
      });
      return;
    }

    setReplaceFiles(files);
  }

  async function handleReplaceSubmit() {
    if (replaceFiles.length === 0) {
      toaster.create({
        description: "Please select file(s) to upload",
        type: "warning",
      });
      return;
    }

    if (!selectedTargetShapefile) {
      toaster.create({
        description: "Please select a GIS layer to replace",
        type: "warning",
      });
      return;
    }

    // Check if uploading shapefile and validate companion files
    const hasShpFile = replaceFiles.some(f => f.name.toLowerCase().endsWith('.shp'));
    if (hasShpFile) {
      // Find the base name of the .shp file
      const shpFile = replaceFiles.find(f => f.name.toLowerCase().endsWith('.shp'))!;
      const baseName = shpFile.name.slice(0, -4); // Remove .shp extension

      // Check for required companion files
      const requiredExtensions = ['.shp', '.shx', '.dbf'];
      const presentExtensions = replaceFiles.map(f => {
        const match = f.name.match(/^(.+)(\.[^.]+)$/);
        return match && match[1] === baseName ? match[2].toLowerCase() : null;
      }).filter(Boolean);

      const missingRequired = requiredExtensions.filter(ext => !presentExtensions.includes(ext));

      if (missingRequired.length > 0) {
        toaster.create({
          description: `Incomplete shapefile! Missing required files: ${missingRequired.join(', ')}. A valid shapefile requires .shp, .shx, and .dbf at minimum. Optional: .prj, .cpg, .sbn, .sbx`,
          type: "error",
          duration: 10000,
        });
        return;
      }
    }

    try {
      setReplacing(true);

      // Step 1: Upload all files to temp category
      const uploadResult = await api.uploadShapefiles(replaceFiles, "temp_replace");

      if (uploadResult.errors.length > 0 || uploadResult.count === 0) {
        toaster.create({
          description: `Upload failed: ${uploadResult.errors.join(", ")}`,
          type: "error",
        });
        return;
      }

      // Step 2: Validate compatibility before replacement
      const uploadedPath = uploadResult.uploaded[0].path;

      // Extract layer name from target path if possible (e.g., "area_type/file.shp" -> "area_type")
      const layerName = selectedTargetShapefile.split('/')[0];

      const validationResult = await api.validateShapefileReplacement(
        uploadedPath,
        selectedTargetShapefile,
        layerName
      );

      // Check for fatal errors
      if (validationResult.errors.length > 0) {
        toaster.create({
          title: "Compatibility Issues Found",
          description: `Cannot replace: ${validationResult.errors.join("; ")}`,
          type: "error",
          duration: 10000,
        });
        return;
      }

      // Check for warnings and ask user confirmation
      if (validationResult.warnings.length > 0) {
        const confirmed = window.confirm(
          `Warnings found:\n\n${validationResult.warnings.join("\n\n")}\n\nContinue with replacement?`
        );
        if (!confirmed) {
          return;
        }
      }

      // Step 3: Replace the target (now safe)
      const replaceResult = await api.replaceShapefiles([
        {
          uploaded_path: uploadedPath,
          target_path: selectedTargetShapefile,
        },
      ]);

      if (replaceResult.errors.length > 0) {
        toaster.create({
          description: `Replace failed: ${replaceResult.errors.join(", ")}`,
          type: "error",
        });
      } else {
        toaster.create({
          description: `Successfully replaced GIS layer!`,
          type: "success",
        });
      }

      // Clear and reload
      setReplaceFiles([]);
      setSelectedTargetShapefile("");
      resetPreviewState();
      await loadAllShapefiles();
      setStep("success");
    } catch (error) {
      toaster.create({
        description: `Replace failed: ${error}`,
        type: "error",
      });
    } finally {
      setReplacing(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }
  return (
    <>
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && handleClose()} size="xl">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content className={v2ModalClass} style={v2 ? { fontFamily: "Inter, sans-serif", borderRadius: "0.375rem", border: "1px solid #E2E8F0" } : undefined}>
            <Dialog.Header>
              <Dialog.Title style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: "1.25rem", color: "#2D3748" } : undefined}>
                {step === "choice" && "Update GIS Layers"}
                {step === "add" && "Add GIS Layer"}
                {step === "replace" && "Replace GIS Layer"}
                {step === "success" && "Success!"}
              </Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>

            <Dialog.Body>
              {/* Choice Screen */}
              {step === "choice" && (
                <Box>
                  <Text mb={4} color="fg.muted">
                    Choose an action:
                  </Text>
                  <div className="upload-choice-container">
                    <div
                      className="upload-choice-chip"
                      onClick={() => handleChoiceSelect("add")}
                    >
                      <div className="upload-choice-icon">
                        <LuPlus />
                      </div>
                      <div className="upload-choice-text">Add GIS Layer</div>
                      <Text fontSize="xs" color="fg.muted" textAlign="center" px={2} className="upload-choice-description">
                        Upload new GIS layers
                      </Text>
                    </div>

                    <div
                      className="upload-choice-chip"
                      onClick={() => handleChoiceSelect("replace")}
                    >
                      <div className="upload-choice-icon">
                        <LuRefreshCw />
                      </div>
                      <div className="upload-choice-text">Replace GIS Layer</div>
                      <Text fontSize="xs" color="fg.muted" textAlign="center" px={2} className="upload-choice-description">
                        Update existing layers
                      </Text>
                    </div>
                  </div>
                </Box>
              )}

              {/* Add Shapefile Screen */}
              {step === "add" && (
                <Box>
                  {/* Dropzone */}
                  <div
                    className={`dropzone ${dragActive ? "drag-active" : ""}`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="dropzone-icon">
                      <LuUpload />
                    </div>
                    <Text fontWeight={v2 ? "700" : "600"} mb={2}>
                      Drag and drop files here
                    </Text>
                    <Text fontSize={v2 ? "md" : "sm"} color="fg.muted" mb={3}>
                      or click to browse
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      Accepts a ZIP file (recommended) or individual GIS layer files (.shp + companions, .geojson, .kml, .gpx, etc.)
                    </Text>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx,.geojson,.kml,.kmz,.gml,.gpx,.json"
                      style={{ display: "none" }}
                      onChange={handleFileSelect}
                    />
                  </div>

                  {/* File List */}
                  {uploadFiles.length > 0 && (
                    <div className="file-list">
                      <Text fontWeight={v2 ? "700" : "600"} mb={2}>
                        Selected Files ({uploadFiles.length})
                      </Text>
                      {uploadFiles.map((file, index) => (
                        <div key={index} className="file-item">
                          <div className="file-info">
                            <div className="file-icon">
                              <LuFile />
                            </div>
                            <div className="file-details">
                              <div className="file-name">{file.name}</div>
                              <div className="file-size">{formatBytes(file.size)}</div>
                            </div>
                          </div>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            onClick={() => removeFile(index)}
                          >
                            <LuX />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Map Preview – always visible */}
                  <Box mt={4}>
                    <Text fontWeight={v2 ? "700" : "600"} fontSize={v2 ? "md" : "sm"} mb={2}>
                      Layer Preview
                      {!previewGeoJSON && !previewLoading && (
                        <Text as="span" fontWeight="400" color="gray.400" fontSize="xs" ml={2}>
                          (select a shapefile above to preview it)
                        </Text>
                      )}
                    </Text>
                    <Box h="280px" borderRadius="md" overflow="hidden" border="1px solid" borderColor="gray.200" position="relative">
                      {previewLoading && (
                        <Box position="absolute" inset="0" zIndex={500} bg="whiteAlpha.800"
                          display="flex" alignItems="center" justifyContent="center" flexDirection="column" gap={2}>
                          <Spinner size="lg" color="blue.500" />
                          <Text fontSize={v2 ? "md" : "sm"} color="gray.600">Generating preview...</Text>
                        </Box>
                      )}
                      {previewError && !previewLoading && (
                        <Box position="absolute" bottom={2} left={2} right={2} zIndex={500}
                          bg="red.50" p={2} borderRadius="md" border="1px solid" borderColor="red.200">
                          <Text fontSize="xs" color="red.600">{previewError}</Text>
                        </Box>
                      )}
                      <MapContainer
                        center={[1.3521, 103.8198]}
                        zoom={11}
                        minZoom={10}
                        maxZoom={18}
                        maxBounds={[[1.05, 103.49], [1.57, 104.21]]}
                        maxBoundsViscosity={1.0}
                        style={{ width: "100%", height: "100%" }}
                        scrollWheelZoom
                      >
                        <ThemeAwareTileLayer />
                        {previewGeoJSON && !previewLoading && (
                          <>
                            <FitBoundsGeoJSON data={previewGeoJSON} />
                            <GeoJSON data={previewGeoJSON}
                              style={{ color: "#2563eb", weight: 2, fillOpacity: 0.25 }} />
                          </>
                        )}
                      </MapContainer>
                    </Box>
                  </Box>

                  {/* New Category Name Input (Now always visible) */}
                  <Box mt={4} mb={4}>
                    <Text fontWeight={v2 ? "700" : "600"} mb={2}>New Category Name</Text>
                    <Box display="flex" alignItems="center" gap={2}>
                      <LuFolderInput />
                      <Input
                        placeholder="e.g., area_type, bus_stop"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                      />
                    </Box>
                  </Box>

                  {/* Required Columns (optional) */}
                  <Box mb={4}>
                    <Text fontWeight={v2 ? "700" : "600"} mb={2}>Required Columns</Text>
                    <Input
                      placeholder="e.g. WIDTH, SURFACE_TYPE"
                      value={addRequiredColumns}
                      onChange={(e) => setAddRequiredColumns(e.target.value)}
                    />
                  </Box>

                  {/* Affects (mandatory for new layers) — pick a category, then attributes within it */}
                  <Box mb={4}>
                    <Text fontWeight={v2 ? "700" : "600"} mb={2}>
                      Affects <Text as="span" color="red.500">*</Text>
                    </Text>

                    {/* Step 1: choose a category */}
                    <Box display="flex" gap={2} flexWrap="wrap" mb={2}>
                      {addAffectsCategoryNames.map((cat) => (
                        <Button
                          key={cat}
                          size="xs"
                          variant={addActiveAffectsCategory === cat ? "solid" : "outline"}
                          colorPalette="blue"
                          onClick={() => setAddActiveAffectsCategory(cat)}
                        >
                          {cat}
                        </Button>
                      ))}
                    </Box>

                    {/* Step 2: choose attributes within the selected category */}
                    <Box maxH="180px" overflowY="auto" borderWidth="1px" borderRadius="md" p={2} mb={2}>
                      {(addParameterGroups[addActiveAffectsCategory] || []).map((opt) => (
                        <Box key={opt} py="4px">
                          <Checkbox.Root
                            checked={addAffectsSelected.has(affectsKey(addActiveAffectsCategory, opt))}
                            onCheckedChange={() => toggleAddAffect(addActiveAffectsCategory, opt)}
                          >
                            <Checkbox.HiddenInput />
                            <Checkbox.Control />
                            <Checkbox.Label fontSize="sm">{opt}</Checkbox.Label>
                          </Checkbox.Root>
                        </Box>
                      ))}
                      {addCustomAffectsForActiveCategory.map((opt) => (
                        <Box key={opt} py="4px">
                          <Checkbox.Root
                            checked={addAffectsSelected.has(affectsKey(addActiveAffectsCategory, opt))}
                            onCheckedChange={() => toggleAddAffect(addActiveAffectsCategory, opt)}
                          >
                            <Checkbox.HiddenInput />
                            <Checkbox.Control />
                            <Checkbox.Label fontSize="sm">{opt}</Checkbox.Label>
                          </Checkbox.Root>
                        </Box>
                      ))}
                    </Box>
                    <Box display="flex" gap={2}>
                      <Input
                        placeholder={`Add a custom parameter to "${addActiveAffectsCategory}"...`}
                        size="sm"
                        value={addCustomAffect}
                        onChange={(e) => setAddCustomAffect(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomAffectParam(); } }}
                      />
                      <Button size="sm" onClick={addCustomAffectParam} disabled={!addCustomAffect.trim()}>
                        Add
                      </Button>
                    </Box>

                    {/* Selected affects across all categories */}
                    {addAffectsSelected.size > 0 && (
                      <Box display="flex" flexWrap="wrap" gap={2} mt={3}>
                        {Array.from(addAffectsSelected).map((key) => (
                          <Box
                            key={key}
                            display="flex"
                            alignItems="center"
                            gap={1}
                            px={2}
                            py={1}
                            bg="blue.50"
                            border="1px solid"
                            borderColor="blue.200"
                            borderRadius="md"
                          >
                            <Text fontSize="xs" color="blue.700">{key}</Text>
                            <Button
                              size="2xs"
                              variant="ghost"
                              colorPalette="blue"
                              onClick={() => removeAddAffect(key)}
                              aria-label={`Remove ${key}`}
                            >
                              <LuX />
                            </Button>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>

                  {uploading && (
                    <Box mt={4}>
                      <Text fontSize={v2 ? "md" : "sm"} color="fg.muted" textAlign="center">
                        Uploading GIS layers...
                      </Text>
                    </Box>
                  )}
                </Box>
              )}

              {/* Replace Shapefile Screen */}
              {step === "replace" && (
                <Box>
                  <Text mb={4} color="fg.muted">
                    Upload updated GIS layer and select which one to replace
                  </Text>

                  {/* Dropzone for Replace */}
                  <div
                    className={`dropzone ${replaceDragActive ? "drag-active" : ""}`}
                    onDragEnter={handleReplaceDragEnter}
                    onDragLeave={handleReplaceDragLeave}
                    onDragOver={handleReplaceDragOver}
                    onDrop={handleReplaceDrop}
                    onClick={() => replaceFileInputRef.current?.click()}
                  >
                    <div className="dropzone-icon">
                      <LuUpload />
                    </div>
                    <Text fontWeight={v2 ? "700" : "600"} mb={2}>
                      Drag and drop file here
                    </Text>
                    <Text fontSize={v2 ? "md" : "sm"} color="fg.muted" mb={3}>
                      or click to browse
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      Accepts a ZIP file (recommended) or individual GIS layer files (.shp + companions, .geojson, .kml, .gpx, etc.)
                    </Text>
                    <Text fontSize="xs" color="orange.500" mt={1}>
                      For individual shapefiles: Upload ALL companion files (.shp, .shx, .dbf, .prj, etc.) together
                    </Text>
                    <input
                      ref={replaceFileInputRef}
                      type="file"
                      multiple
                      accept=".zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx,.geojson,.kml,.kmz,.gml,.gpx,.json"
                      style={{ display: "none" }}
                      onChange={handleReplaceFileSelect}
                    />
                  </div>

                  {/* Selected Files Display */}
                  {replaceFiles.length > 0 && (
                    <div className="file-list">
                      <Text fontWeight={v2 ? "700" : "600"} mb={2}>
                        Selected Files ({replaceFiles.length})
                      </Text>
                      {replaceFiles.map((file, index) => (
                        <div key={index} className="file-item">
                          <div className="file-info">
                            <div className="file-icon">
                              <LuFile />
                            </div>
                            <div className="file-details">
                              <div className="file-name">{file.name}</div>
                              <div className="file-size">{formatBytes(file.size)}</div>
                            </div>
                          </div>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            onClick={() => setReplaceFiles(prev => prev.filter((_, i) => i !== index))}
                          >
                            <LuX />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Select Target Shapefile (Searchable) */}
                  <Box mb={4} mt={6} position="relative" ref={targetSearchRef}>
                    <Text fontWeight={v2 ? "700" : "600"} mb={2}>Select GIS Layer to Replace</Text>
                    <Input
                      placeholder="Type to filter layers by folder or name..."
                        value={targetShapefileSearch}
                        onChange={(e) => {
                          setTargetShapefileSearch(e.target.value);
                          setIsTargetDropdownOpen(true);
                        }}
                        onFocus={() => setIsTargetDropdownOpen(true)}
                      />
                      {isTargetDropdownOpen && (
                        <Box
                          position="absolute"
                          top="100%"
                          left={0}
                          right={0}
                          zIndex={1000}
                          bg="white"
                          boxShadow="lg"
                          borderRadius="md"
                          mt={1}
                          maxH="200px"
                          overflowY="auto"
                          border="1px solid"
                          borderColor="gray.200"
                        >
                          {filteredTargetShapefiles.length > 0 ? (
                            filteredTargetShapefiles.map((shp) => (
                              <Box
                                key={shp.path}
                                px={3}
                                py={2}
                                cursor="pointer"
                                _hover={{ bg: "gray.100" }}
                                onClick={() => {
                                  setSelectedTargetShapefile(shp.path);
                                  setTargetShapefileSearch(`${shp.category} / ${shp.name}`);
                                  setIsTargetDropdownOpen(false);
                                }}
                                display="flex"
                                alignItems="center"
                                justifyContent="space-between"
                              >
                                <Text fontSize={v2 ? "md" : "sm"}>{shp.category} / {shp.name}</Text>
                                {selectedTargetShapefile === shp.path && (
                                  <Box color="blue.500"><LuCheck /></Box>
                                )}
                              </Box>
                            ))
                          ) : (
                            <Box px={3} py={2} color="fg.muted" fontSize={v2 ? "md" : "sm"}>
                              No layers match your search
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>


                  {replacing && (
                    <Box mt={4}>
                      <Text fontSize={v2 ? "md" : "sm"} color="fg.muted" textAlign="center">
                        Replacing GIS layer...
                      </Text>
                    </Box>
                  )}
                </Box>
              )}

              {/* Success Screen */}
              {step === "success" && (
                <Box textAlign="center" py={6}>
                  <Box fontSize="4xl" color="green.500" mb={4}>
                    <LuCheck />
                  </Box>
                  <Text fontSize="xl" fontWeight={v2 ? "700" : "600"} mb={2}>
                    Operation Completed!
                  </Text>
                  <Text color="fg.muted" mb={6}>
                    What would you like to do next?
                  </Text>
                  <Box display="flex" flexDirection="column" gap={2}>
                    <Button
                      onClick={() => setStep("add")}
                      colorPalette="blue"
                      variant="outline"
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem", borderColor: "#CBD5E0", color: "#2D3748" } : undefined}
                    >
                      Add More GIS Layers
                    </Button>
                    <Button
                      onClick={() => setStep("replace")}
                      colorPalette="blue"
                      variant="outline"
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem", borderColor: "#CBD5E0", color: "#2D3748" } : undefined}
                    >
                      Replace More GIS Layers
                    </Button>
                    <Button
                      onClick={handleClose}
                      colorPalette="gray"
                      variant="solid"
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem", background: "#1A202C", color: "#fff" } : undefined}
                    >
                      Done
                    </Button>
                  </Box>
                </Box>
              )}
            </Dialog.Body>

            {step !== "success" && (
              <Dialog.Footer>
                <Box display="flex" gap={3} width="100%" justifyContent="flex-end">
                  {step !== "choice" && (
                    <Button
                      variant="outline"
                      onClick={handleBackToChoice}
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem", borderColor: "#CBD5E0", color: "#2D3748" } : undefined}
                    >
                      Back
                    </Button>
                  )}
                  {step === "choice" && (
                    <Button
                      variant="outline"
                      onClick={handleClose}
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem", borderColor: "#CBD5E0", color: "#2D3748" } : undefined}
                    >
                      Cancel
                    </Button>
                  )}
                  {step === "add" && (
                    <Button
                      colorPalette="blue"
                      onClick={() => setShowUploadConfirm(true)}
                      disabled={uploadFiles.length === 0 || uploading || addAffectsSelected.size === 0}
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem" } : undefined}
                    >
                      Upload {uploadFiles.length > 0 && `(${uploadFiles.length})`}
                    </Button>
                  )}
                  {step === "replace" && (
                    <Button
                      colorPalette="blue"
                      onClick={handleReplaceSubmit}
                      disabled={replaceFiles.length === 0 || !selectedTargetShapefile || replacing}
                      style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem" } : undefined}
                    >
                      Replace {replaceFiles.length > 0 && `(${replaceFiles.length} file${replaceFiles.length > 1 ? 's' : ''})`}
                    </Button>
                  )}
                </Box>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>

      {/* Upload Confirmation Dialog */}
      <Dialog.Root
        open={showUploadConfirm}
        onOpenChange={(e) => !e.open && setShowUploadConfirm(false)}
        size="md"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content className={v2ModalClass} style={v2 ? { fontFamily: "Inter, sans-serif", borderRadius: "0.375rem", border: "1px solid #E2E8F0" } : undefined}>
              <Dialog.Header>
                <Dialog.Title style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: "1.25rem", color: "#2D3748" } : undefined}>Before You Upload</Dialog.Title>
                <Dialog.CloseTrigger />
              </Dialog.Header>
              <Dialog.Body>
                <Text mb={3} color="fg.muted" fontSize={v2 ? "md" : undefined}>
                  Please confirm that the shapefile you are about to upload meets <strong>all</strong> of the following requirements:
                </Text>
                <Box as="ul" pl={5} mb={4} style={{ listStyleType: "disc" }}>
                  <Box as="li" mb={2}>
                    <Text fontSize={v2 ? "md" : "sm"}>
                      <strong>Exact file name</strong> — The file name must exactly match what the system expects.
                    </Text>
                  </Box>
                  <Box as="li" mb={2}>
                    <Text fontSize={v2 ? "md" : "sm"}>
                      <strong>Exact columns and numbers</strong> — The shapefile must contain the correct number of columns, with no extras or omissions.
                    </Text>
                  </Box>
                  <Box as="li" mb={2}>
                    <Text fontSize={v2 ? "md" : "sm"}>
                      <strong>Exact attribute names</strong> — Every column/attribute name must match exactly, including capitalisation.
                    </Text>
                  </Box>
                  <Box as="li" mb={2}>
                    <Text fontSize={v2 ? "md" : "sm"}>
                      <strong>Exact sequence</strong> — The columns must appear in exactly the same order as specified.
                    </Text>
                  </Box>
                </Box>
                <Text fontSize={v2 ? "md" : "sm"} color="orange.600" fontWeight={v2 ? "700" : "500"}>
                  Uploading an incompatible shapefile may cause system errors or incorrect data rendering.
                </Text>
                <Text fontSize={v2 ? "md" : "sm"} color="fg.muted" mt={3}>
                  If you are unsure of the expected format, refer to the existing shapefiles in the GIS Layers list as a reference.
                </Text>
              </Dialog.Body>
              <Dialog.Footer>
                <Box display="flex" gap={3} width="100%" justifyContent="flex-end">
                  <Button
                    variant="outline"
                    onClick={() => setShowUploadConfirm(false)}
                    style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem", borderColor: "#CBD5E0", color: "#2D3748" } : undefined}
                  >
                    Cancel
                  </Button>
                  <Button
                    colorPalette="blue"
                    onClick={() => {
                      setShowUploadConfirm(false);
                      handleAddUpload();
                    }}
                    style={v2 ? { fontFamily: "Inter, sans-serif", fontWeight: 700, borderRadius: "0.375rem" } : undefined}
                  >
                    Confirm &amp; Upload
                  </Button>
                </Box>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}
