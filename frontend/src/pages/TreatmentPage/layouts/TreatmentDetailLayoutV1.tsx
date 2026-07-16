/**
 * Treatment Application — V1 layout shell. Props-driven from TreatmentViewModel.
 * Segment view uses auto-save (no Apply button); treatment view uses Apply-to-All.
 */
import {
  Box,
  Flex,
  Grid,
  GridItem,
  Text,
  Spinner,
  NumberInput,
  Button,
  Dialog,
  Portal,
  CloseButton,
} from "@chakra-ui/react";
import { LuCheck, LuCopy, LuImage } from "react-icons/lu";
import type { Feature, LineString } from "geojson";

import { Switch } from "../../../components/ui/switch";
import { Tooltip } from "../../../components/ui/tooltip";
import ImagePanel from "../../CodingPage/components/ImagePanel";
import PostTreatmentImageUpload from "../components/PostTreatmentImageUpload";
import AttributesPanel from "../../CodingPage/components/AttributesPanel";
import GeoDataPanel from "../../CodingPage/components/GeoDataPanel";
import SegmentScoresCard from "../../../components/visualization/scoreband/SegmentScoresCard";
import OverallTreatmentAnalysis from "../../../components/visualization/scoreband/OverallTreatmentAnalysis";

import {
  PANEL_HEIGHT,
  CONTROLS_H,
  MAP_HEIGHT,
  TREATMENTS,
  getApplicableTreatments,
  type Treatment,
} from "../treatmentConstants";
import type { TreatmentViewModel } from "./TreatmentViewModel";

export default function TreatmentDetailLayoutV1(vm: TreatmentViewModel) {
  const {
    projectNames, loading, error, isAllScope, activeProject, len,
    scope, panKey, currentCtx, scopeTotal, scopePage, pageInput, pageIndices,
    geoFeatures, currentIndex, scores, afterTreatmentScores,
    accordionView, attrs, catalogReady, effectivenessLoading, allApplicableTreatments,
    effectivenessCounts, applicableCounts, segmentScoreDrops, treatmentState,
    fullyAppliedTreatments, selectedTreatments, applyLoading,
    hasApplied, hasSelected, appliedTreatmentIds, copyButtonState, copyButtonLabel,
    currentImageUrl, imageCopyButtonState, imageCopyButtonLabel,
    currentPage, imgRef, showPostTreatment, segmentHasTreatments,
    modifiedAttrs, changedAttributes, changedFieldSources, attrMappings,
    activeAttributeGroupTab, previewScores, previewLoading, projectContributors,
    beforeBandCounts, afterBandCounts, openConfirmAlert,
    autoSaveStatus, isStagingPreview, mapFilterContext,
  } = vm;

  if (projectNames.length === 0) {
    return (
      <Box p="4">
        <Text color="red.500">Invalid project name.</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Flex align="center" justify="center" h="60vh">
        <Spinner size="lg" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Box p="4">
        <Text color="red.500">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box p="4">
      <Flex mb="3">
        <Button variant="outline" colorPalette="gray" size="sm" onClick={vm.onBack}>
          ← Back to Analysis
        </Button>
      </Flex>

      {/* Project Tabs */}
      {projectNames.length > 1 && (
        <Flex gap="2" mb="4" wrap="wrap">
          {/* All Projects tab — aggregate view across every loaded project */}
          <Button
            onClick={() => vm.onSelectAllProjects()}
            variant={isAllScope ? "solid" : "outline"}
            colorPalette={isAllScope ? "blue" : "gray"}
            size="md"
          >
            All Projects ({vm.filterMode ? pageIndices.length : len})
          </Button>
          {projectNames.map((proj) => {
            const isActive = activeProject === proj;
            const segmentCount = vm.getProjectSegmentCount(proj);
            if (segmentCount === 0) return null;
            return (
              <Button
                key={proj}
                onClick={() => vm.onSelectProject(proj)}
                variant={isActive ? "solid" : "outline"}
                colorPalette={isActive ? "blue" : "gray"}
                size="md"
              >
                {proj} ({segmentCount})
              </Button>
            );
          })}
        </Flex>
      )}

      {/* Header with project info and pagination */}
      <Flex justify="space-between" align="center" mb="3">
        <Box>
          <Text fontSize="lg" fontWeight="bold" color="gray.900" _dark={{ color: "white" }}>
            {currentCtx ? currentCtx.name : "Unknown Project"}
          </Text>
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
            Loaded: {projectNames.length} project{projectNames.length > 1 ? 's' : ''}
          </Text>
        </Box>

        <Flex align="center" gap="3">
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
            {scopeTotal > 0 ? `${scopePage} / ${scopeTotal}` : "0 / 0"}
          </Text>

          <NumberInput.Root
            maxW="120px"
            min={1}
            max={scopeTotal || 1}
            defaultValue={String(scopePage)}
            value={pageInput}
            onValueChange={(e) => vm.setPageInput(e.value)}
          >
            <NumberInput.Control />
            <NumberInput.Input
              onBlur={() => vm.commitPage(pageInput)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.currentTarget.blur();
                }
              }}
            />
          </NumberInput.Root>
        </Flex>
      </Flex>

      {/* Map Previews: Before and After Treatment - Side by Side */}
      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap="16px" mb="6" w="100%">
        {/* Before Treatment Map */}
        <GridItem minW="0" w="100%">
          <GeoDataPanel
            projectName={currentCtx ? currentCtx.name : ""}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => vm.gotoPage(i + 1)}
            containerHeight={MAP_HEIGHT}
            subtitle="Before Treatment"
            geoFeatures={geoFeatures as Feature<LineString, any>[]}
            startIndex={0}
            scores={scores as any}
            scopeRange={isAllScope ? null : scope}
            filterContext={mapFilterContext}
            autoFitKey={panKey}
            disableAutoFit
            panKey={panKey}
          />
        </GridItem>

        {/* After Treatment Map */}
        <GridItem minW="0" w="100%">
          <GeoDataPanel
            projectName={currentCtx ? currentCtx.name : ""}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => vm.gotoPage(i + 1)}
            containerHeight={MAP_HEIGHT}
            scores={afterTreatmentScores as any}
            subtitle="After Treatment"
            geoFeatures={geoFeatures as Feature<LineString, any>[]}
            startIndex={0}
            scopeRange={isAllScope ? null : scope}
            filterContext={mapFilterContext}
            autoFitKey={panKey}
            disableAutoFit
            panKey={panKey}
          />
        </GridItem>
      </Grid>

      {/* Main layout: 3 Columns - Image | Treatments | Scores+Attributes */}
      <Grid templateColumns={{ base: "1fr", lg: "0.5fr 1.5fr 1.5fr" }} gap="16px" mb="6">
        {/* Left: Recommended Treatments (Vertical, Scrollable) */}
        <GridItem position="relative" minH={{ base: "400px", lg: "0" }}>
          <Box
            position={{ base: "relative", lg: "absolute" }}
            top="0" bottom="0" left="0" right="0"
            display="flex"
            flexDirection="column"
            bg="gray.50"
            _dark={{ bg: "gray.800" }}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="md"
            overflow="hidden"
          >
          <Box p="3" borderBottomWidth="1px" borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
            <Text fontSize="sm" fontWeight="bold" color="gray.700" _dark={{ color: "gray.200" }}>
              Treatment Options
            </Text>
            <Tooltip
              content={
                accordionView === "segment" ? (
                  <Text>
                    <b>By Segment:</b> View and apply treatments for the current segment only.
                  </Text>
                ) : (
                  <Text>
                    <b>By Treatment:</b> View and apply a single treatment across all applicable segments.
                  </Text>
                )
              }
              showArrow
              openDelay={400}
              contentProps={{ maxW: "250px" }}
            >
              <Box mt="2">
                <select
                  value={accordionView}
                  onChange={(e) => {
                    vm.setAccordionView(e.target.value as "segment" | "treatment");
                    vm.setSelectedTreatments(new Set());
                  }}
                  style={{
                    width: "100%",
                    padding: "6px",
                    borderRadius: "6px",
                    border: "1px solid var(--chakra-colors-gray-300)",
                    backgroundColor: "white",
                    color: "inherit",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                  className="theme-select"
                >
                  <option value="segment">By Segment</option>
                  <option value="treatment">By Treatment</option>
                </select>
              </Box>
            </Tooltip>
          </Box>

          <Box flex="1" overflowY="auto" p="3">
            {(() => {
              let displayTreatments: Treatment[] = [];
              const currentAttr = attrs[currentIndex] as any;

              // Catalog still loading: the module-level TREATMENTS array is empty, so
              // getApplicableTreatments() would return [] for every segment and wrongly
              // render "No treatments applicable". Show a loading state until it resolves.
              if (!catalogReady) {
                return (
                  <Flex direction="column" align="center" justify="center" gap="3" py="8">
                    <Spinner size="sm" color="blue.500" />
                    <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                      Loading treatments...
                    </Text>
                  </Flex>
                );
              }

              if (accordionView === "segment") {
                if (!currentAttr) {
                  return <Text fontSize="xs" color="gray.400">No segment data</Text>;
                }
                displayTreatments = getApplicableTreatments(currentAttr)
                  .sort((a, b) => (segmentScoreDrops[b.id] ?? 0) - (segmentScoreDrops[a.id] ?? 0));
              } else {
                if (effectivenessLoading) {
                  return (
                    <Flex direction="column" align="center" justify="center" gap="3" py="8">
                      <Spinner size="sm" color="blue.500" />
                      <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                        Ranking Treatment Options...
                      </Text>
                    </Flex>
                  );
                }
                displayTreatments = allApplicableTreatments.filter(t =>
                  (effectivenessCounts[t.id] ?? 0) > 0
                );
              }

              if (displayTreatments.length === 0) {
                return (
                  <Text fontSize="xs" color="gray.400" _dark={{ color: "gray.500" }}>
                    {accordionView === "segment" ? "No treatments applicable" : "No treatments applicable in whole project"}
                  </Text>
                );
              }

              return (
                <Flex direction="column" gap="2">
                  {displayTreatments.map((t) => {
                    const isApplied = accordionView === "segment"
                      ? !!(treatmentState[currentIndex]?.applied && treatmentState[currentIndex]?.treatment_ids.includes(t.id))
                      : fullyAppliedTreatments.has(t.id);

                    // Segment view: always toggleable (auto-saves); treatment view: lock applied rows
                    const isDisabled = accordionView === "segment" ? false : isApplied;
                    // Green "applied" styling only for the bulk view; segment view stays blue
                    const showAppliedStyle = accordionView === "segment" ? false : isApplied;

                    return (
                      <Flex
                        key={t.id}
                        gap="2"
                        align="flex-start"
                        p="2"
                        borderRadius="md"
                        bg={
                          showAppliedStyle
                            ? "green.50"
                            : selectedTreatments.has(t.id)
                              ? "blue.50"
                              : "white"
                        }
                        borderWidth="1px"
                        borderColor={
                          showAppliedStyle
                            ? "green.200"
                            : selectedTreatments.has(t.id)
                              ? "blue.200"
                              : "gray.200"
                        }
                        cursor={isDisabled ? "not-allowed" : "pointer"}
                        opacity={isDisabled ? 0.6 : 1}
                        transition="all 0.2s"
                        _hover={{
                          borderColor: isDisabled ? undefined : "blue.300",
                          shadow: isDisabled ? undefined : "sm"
                        }}
                        _dark={{
                          bg: showAppliedStyle
                            ? "green.900"
                            : selectedTreatments.has(t.id)
                              ? "blue.900"
                              : "gray.700",
                          borderColor: showAppliedStyle
                            ? "green.700"
                            : selectedTreatments.has(t.id)
                              ? "blue.700"
                              : "gray.600",
                        }}
                        onClick={() => {
                          if (isDisabled) return;
                          const newSelected = new Set(selectedTreatments);
                          if (newSelected.has(t.id)) {
                            newSelected.delete(t.id);
                          } else {
                            newSelected.add(t.id);
                          }
                          vm.setSelectedTreatments(newSelected);
                          if (accordionView === "segment") {
                            vm.scheduleSegmentSave(Array.from(newSelected).sort((a, b) => a - b));
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={accordionView === "segment" ? selectedTreatments.has(t.id) : (isApplied || selectedTreatments.has(t.id))}
                          disabled={isDisabled}
                          onChange={() => { }}
                          style={{ marginTop: '3px', cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                          aria-label={`Select treatment: ${t.name}`}
                        />
                        <Box flex="1">
                          <Text fontSize="xs" fontWeight="medium" color="gray.900" _dark={{ color: "white" }} lineHeight="1.2">
                            {t.name}
                            {showAppliedStyle && " ✓"}
                          </Text>
                          {accordionView === "treatment" && (
                            <Text fontSize="2xs" color="blue.600" _dark={{ color: "blue.300" }} mt="1" fontWeight="semibold">
                              {(() => {
                                const count = effectivenessCounts[t.id] ?? 0;
                                const applicable = applicableCounts[t.id] ?? 0;
                                const denominator = applicable > 0 ? applicable : attrs.length;
                                const pct = (denominator > 0 && count > 0) ? count / denominator * 100 : 0;
                                const display = count > 0 ? Math.max(0.1, pct).toFixed(1) : "0.0";
                                const scopeLabel = applicable > 0 ? "applicable segments" : "segments";
                                return `Improves ${display}% of ${scopeLabel}`;
                              })()}
                            </Text>
                          )}
                          {accordionView === "segment" && segmentScoreDrops[t.id] !== undefined && (
                            <Text fontSize="2xs" color="blue.600" _dark={{ color: "blue.300" }} mt="1" fontWeight="semibold">
                              {`Score drop: ${segmentScoreDrops[t.id].toFixed(1)}`}
                            </Text>
                          )}
                          {t.description && (
                            <Text fontSize="2xs" color="gray.500" _dark={{ color: "gray.400" }} mt="1">
                              {t.description}
                            </Text>
                          )}
                        </Box>
                      </Flex>
                    );
                  })}
                </Flex>
              );
            })()}
          </Box>

          {/* Action Buttons Footer */}
          <Box p="3" borderTopWidth="1px" borderColor="gray.200" bg="white" _dark={{ borderColor: "gray.700", bg: "gray.800" }}>
            <Flex direction="column" gap="2">
              <Flex gap="2">
                <Button
                  flex="1"
                  size="xs"
                  variant="outline"
                  colorScheme={selectedTreatments.size > 0 ? "red" : "blue"}
                  disabled={
                    (() => {
                      if (accordionView === "segment") {
                        const currentAttr = attrs[currentIndex] as any;
                        if (!currentAttr) return true;
                        return getApplicableTreatments(currentAttr).length === 0;
                      }
                      return allApplicableTreatments.length === 0;
                    })()
                  }
                  onClick={() => {
                    let next: Set<number>;
                    if (selectedTreatments.size > 0) {
                      next = new Set();
                    } else if (accordionView === "segment") {
                      const currentAttr = attrs[currentIndex] as any;
                      if (!currentAttr) return;
                      next = new Set(getApplicableTreatments(currentAttr).map(t => t.id));
                    } else {
                      next = new Set(allApplicableTreatments.map(t => t.id));
                    }
                    vm.setSelectedTreatments(next);
                    if (accordionView === "segment") {
                      vm.scheduleSegmentSave(Array.from(next).sort((a, b) => a - b));
                    }
                  }}
                >
                  {selectedTreatments.size > 0 ? "Clear" : "All"}
                </Button>
                {accordionView === "segment" && autoSaveStatus !== "idle" && (
                  <Flex flex="1" align="center" justify="flex-end" gap="1" fontSize="xs">
                    {autoSaveStatus === "saving" ? (
                      <>
                        <Spinner size="xs" />
                        <Text color="gray.500" _dark={{ color: "gray.400" }}>Saving…</Text>
                      </>
                    ) : (
                      <>
                        <LuCheck color="#22c55e" />
                        <Text color="green.600" _dark={{ color: "green.300" }}>Saved</Text>
                      </>
                    )}
                  </Flex>
                )}
              </Flex>

              <Flex width="full" gap="2" align="stretch" wrap="wrap">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Copy treatment prompt"
                  disabled={accordionView === "segment" ? selectedTreatments.size === 0 : (!hasApplied && !hasSelected)}
                  loading={copyButtonState === "copying"}
                  gap="1"
                  onClick={() => {
                    const ids = accordionView === "segment"
                      ? Array.from(selectedTreatments)
                      : (hasApplied ? appliedTreatmentIds : Array.from(selectedTreatments));
                    void vm.onCopyTreatmentPrompt(ids);
                  }}
                >
                  {copyButtonState === "copied" ? <LuCheck /> : <LuCopy />}
                  <span>{copyButtonLabel}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Copy current image"
                  disabled={!currentImageUrl}
                  loading={imageCopyButtonState === "copying"}
                  gap="1"
                  onClick={() => { void vm.onCopyCurrentImage(); }}
                >
                  {imageCopyButtonState === "copied" ? <LuCheck /> : <LuImage />}
                  <span>{imageCopyButtonLabel}</span>
                </Button>
                {/* Segment view auto-saves on toggle; Apply only drives the bulk "by treatment" flow */}
                {accordionView !== "segment" && (
                  <Button
                    size="sm"
                    flex="1"
                    variant="solid"
                    colorScheme="blue"
                    disabled={selectedTreatments.size === 0 || applyLoading}
                    loading={applyLoading}
                    onClick={() => {
                      if (selectedTreatments.size === 0 || !currentCtx) return;
                      vm.setOpenConfirmAlert(true);
                    }}
                  >
                    {`Apply (${selectedTreatments.size})`}
                  </Button>
                )}
              </Flex>
            </Flex>
          </Box>
          </Box>
        </GridItem>

        {/* Middle: Image Panel + Navigation Controls */}
        <GridItem
          display="flex"
          flexDirection="column"
          minH={`${PANEL_HEIGHT}px`}
        >
          {/* Navigation Controls */}
          <Flex
            flex="0 0 auto"
            h={`${CONTROLS_H}px`}
            w="100%"
            minW={0}
            align="center"
            gap="2"
            mb="4"
            position="relative"
            zIndex={1}
            bg="bg"
          >
            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="outline"
              onClick={() => {
                const prev = pageIndices[scopePage - 2];
                if (prev !== undefined) vm.gotoPage(prev + 1);
              }}
              disabled={scopePage <= 1}
            >
              Previous
            </Button>

            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="solid"
              onClick={() => {
                const next = pageIndices[scopePage];
                if (next !== undefined) vm.gotoPage(next + 1);
              }}
              disabled={scopePage >= scopeTotal}
            >
              Next
            </Button>
          </Flex>

          <Box flex="1 1 auto" minH={0} display="flex" flexDirection="column">
            <Box flex="1 1 50%" minH={0} display="flex" flexDirection="column">
              <ImagePanel
                projectName={currentCtx?.name}
                imageRef={imgRef}
              />
            </Box>
            <Box flex="1 1 50%" minH={0} display="flex" flexDirection="column">
              <PostTreatmentImageUpload
                projectName={currentCtx?.name || ""}
                segmentIndex={(currentCtx?.localIndex ?? currentIndex) + 1}
              />
            </Box>
          </Box>
        </GridItem>

        {/* Right: Crash Type Scores + Attributes Panel */}
        <GridItem
          display="flex"
          flexDirection="column"
          gap="4"
        >
          <Box
            bg="white"
            borderRadius="md"
            p="1"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
          >
            <SegmentScoresCard
              scores={(() => {
                const originalScores = scores[currentIndex] as any || null;
                const appliedAfterScores = treatmentState[currentIndex]?.after_scores;
                const appliedScoreRow = appliedAfterScores
                  ? {
                    ...scores[currentIndex],
                    BB: appliedAfterScores.BB,
                    BP: appliedAfterScores.BP,
                    SB: appliedAfterScores.SB,
                    VB: appliedAfterScores.VB,
                    "Overall Risk Level": appliedAfterScores.total,
                  } as any
                  : originalScores;

                // Live preview only for the bulk "by treatment" view's staged selection
                if (isStagingPreview) {
                  if (previewLoading || !previewScores) {
                    return appliedScoreRow;
                  }
                  return {
                    ...scores[currentIndex],
                    BB: previewScores.BB,
                    BP: previewScores.BP,
                    SB: previewScores.SB,
                    VB: previewScores.VB,
                    "Overall Risk Level": previewScores.total
                  } as any;
                }

                if (!showPostTreatment) {
                  return originalScores;
                }

                return appliedAfterScores ? appliedScoreRow : originalScores;
              })()}
              beforeScores={
                (isStagingPreview || (showPostTreatment && treatmentState[currentIndex]?.applied))
                  ? {
                    BB: scores[currentIndex]?.["BB"] ?? 0,
                    BP: scores[currentIndex]?.["BP"] ?? 0,
                    SB: scores[currentIndex]?.["SB"] ?? 0,
                    VB: scores[currentIndex]?.["VB"] ?? 0,
                    "Overall Risk Level": scores[currentIndex]?.["Overall Risk Level"] ?? 0,
                  }
                  : undefined
              }
              showPreviewBackground={isStagingPreview}
              projectContributors={projectContributors}
              onContributorClick={vm.onContributorClick}
            />
          </Box>

          <Box
            flex="1"
            minH="0"
            overflow="hidden"
            bg="white"
            borderRadius="md"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
            display="flex"
            flexDirection="column"
          >
            <Flex
              p="2"
              borderBottomWidth="1px"
              borderColor="gray.200"
              _dark={{ borderColor: "gray.700" }}
              align="center"
              justify="space-between"
            >
              <Text fontSize="sm" fontWeight="bold">
                Attributes
              </Text>
              <Flex align="center" gap="2">
                <Text fontSize="xs" color={segmentHasTreatments ? undefined : "gray.400"}>
                  Show Pre-Treatment
                </Text>
                <Switch
                  checked={segmentHasTreatments ? !showPostTreatment : false}
                  disabled={!segmentHasTreatments}
                  onCheckedChange={(e: any) => vm.setShowPostTreatment(!e.checked)}
                />
              </Flex>
            </Flex>
            <Box flex="1" minH="0">
              <AttributesPanel
                row={
                  !showPostTreatment
                    ? attrs[currentIndex]
                    : (isStagingPreview || treatmentState[currentIndex]?.applied)
                      ? modifiedAttrs
                      : attrs[currentIndex]
                }
                mappings={attrMappings}
                changedFields={showPostTreatment ? Array.from(changedAttributes) : []}
                fieldSources={showPostTreatment ? changedFieldSources : {}}
                highlightMessage="Modified by treatment"
                activeGroupTab={activeAttributeGroupTab}
                readOnly={true}
              />
            </Box>
          </Box>
        </GridItem>
      </Grid>

      {/* Overall Analysis Footer */}
      <Box mt="6">
        <OverallTreatmentAnalysis
          beforeBandCounts={beforeBandCounts}
          afterBandCounts={afterBandCounts}
        />
      </Box>

      {/* Confirm Apply All Dialog */}
      <Dialog.Root open={openConfirmAlert} onOpenChange={(d) => vm.setOpenConfirmAlert(d.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Apply Treatments to {isAllScope ? "All Projects" : activeProject}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <p>Are you sure you want to apply the following treatments to all eligible segments in {isAllScope ? "all loaded projects" : activeProject}?</p>
                <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
                  {Array.from(selectedTreatments).map(id => {
                    const t = TREATMENTS.find(tr => tr.id === id);
                    return <li key={id}><strong>{t ? t.name : `Treatment ${id}`}</strong></li>;
                  })}
                </ul>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={applyLoading}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="blue" onClick={vm.onConfirmApplyToAll} loading={applyLoading}>
                  Confirm
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  );
}
