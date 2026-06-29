import {
  Box,
  Flex,
  Grid,
  GridItem,
  Text,
  Spinner,
  NumberInput,
  Button,
  Portal,
  Progress,
  Card,
  CardBody,
} from "@chakra-ui/react";

import ExitConfirmationDialog from "../../sidebar/components/ExitConfirmationDialog";
import ImagePanel from "../components/ImagePanel";
import AttributesPanel from "../components/AttributesPanel";
import GeoDataPanel from "../components/GeoDataPanel";
import SegmentScoresCard from "../../../components/visualization/scoreband/SegmentScoresCard";
import AutocodeValidation from "../../PathAnalysisPage/components/AutocodeValidation";
import CodingAttributeModals from "./CodingAttributeModals";
import type { CodingViewModel } from "./CodingViewModel";

const PANEL_HEIGHT = 550;

/**
 * v1 Coding layout — the current arrangement, extracted verbatim from
 * codingPage.tsx and driven entirely by the CodingViewModel. No data fetching,
 * server state, or sessionStorage lives here; it is a pure function of its props.
 * The attribute-editing modal stack is shared with v2 via CodingAttributeModals.
 */
export default function CodingLayoutV1(vm: CodingViewModel) {
  const {
    projectList,
    projectData,
    activeTab,
    setActiveTab,
    isShowingCodingGuide,
    currentProjectName,
    loading,
    error,
    imagesLoaded,
    imageLoadingProgress,
    autoCoding,
    progress,
    autoCodeMsg,
    projectProgress,
    detail,
    currentData,
    attrs,
    scores,
    geoFeatures,
    currentIndex,
    currentPage,
    len,
    currentAttr,
    originalCurrentAttr,
    imgRef,
    changedFieldsByRow,
    fieldSourcesByRow,
    attrMappings,
    segmentInput,
    setSegmentInput,
    commitSegment,
    autocodedSegmentInput,
    setAutocodedSegmentInput,
    commitAutocodedSegment,
    pageInput,
    setPageInput,
    commitPage,
    gotoPage,
    projectContributors,
    handleContributorClick,
    activeAttributeGroupTab,
    cameFromPathAnalysis,
    currentSegmentVerified,
    toggleCurrentSegmentVerified,
    verifiedByProject,
    filterContext,
    returnToAnalysis,
    onBackToAnalysis,
    onDiscardAndExit,
    onSaveAndExit,
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    isSaving,
    onAttrChange,
    onEdit,
    widthData,
    curvData,
    showCurvatureOverlay,
    setShowCurvatureOverlay,
    refreshCurrentProject,
    setEditingOptions,
  } = vm;

  if (projectList.length === 0) {
    return <Box p="4"><Text color="red.500">No projects selected.</Text></Box>;
  }

  if (!isShowingCodingGuide && (loading || !imagesLoaded)) {
    return (
      <Flex align="center" justify="center" h="60vh" direction="column" gap={4}>
        {loading ? (
          <>
            <Spinner size="lg" />
            <Text>Loading project data...</Text>
          </>
        ) : (
          <>
            <Text fontWeight="bold">Preloading Images...</Text>
            <Progress.Root value={imageLoadingProgress} maxW="300px" w="100%" colorPalette="blue">
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
              <Progress.ValueText>{imageLoadingProgress}%</Progress.ValueText>
            </Progress.Root>
            <Text fontSize="sm" color="gray.500">
              Please wait while we cache images for smooth navigation.
            </Text>
          </>
        )}
      </Flex>
    );
  }

  if (!isShowingCodingGuide && error) {
    return (
      <Box p="4">
        <Text color="red.500">Error: {error}</Text>
      </Box>
    );
  }

  // Show Coding Guide
  if (isShowingCodingGuide) {
    return (
      <Box p="4">
        <Flex gap="2" mb="4" wrap="wrap">
          {projectList.map((projectName) => {
            const projData = projectData[projectName];
            const projSegmentCount = projData?.attrs.length ?? 0;
            const isActive = activeTab === projectName;
            return (
              <Button
                key={projectName}
                onClick={() => setActiveTab(projectName)}
                variant={isActive ? "solid" : "outline"}
                colorPalette={isActive ? "blue" : "gray"}
                size="md"
              >
                {projectName} ({projSegmentCount})
              </Button>
            );
          })}
          <Button
            onClick={() => setActiveTab("coding-guide")}
            variant={isShowingCodingGuide ? "solid" : "outline"}
            colorPalette={isShowingCodingGuide ? "blue" : "gray"}
            size="md"
          >
            Coding Guide
          </Button>
          <Button
            onClick={() => window.open("https://irap.org/cyclerap/", "_blank", "noopener,noreferrer")}
            variant="outline"
            colorPalette="gray"
            size="md"
          >
            CycleRAP
          </Button>
        </Flex>
        <Box
          borderWidth="1px"
          borderColor="gray.200"
          borderRadius="md"
          overflow="hidden"
          h="calc(100vh - 150px)"
        >
          <iframe
            src="/PSAT coding sheetMay26.pdf"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            title="Coding Guide PDF"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box p="4">
      {autoCoding && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            bg="blackAlpha.400"
            backdropFilter="blur(2px)"
            zIndex={1000}
            aria-busy="true"
          >
            <Progress.Root
              value={progress}
              min={0}
              max={100}
              orientation="horizontal"
              colorPalette="blue"
              variant="subtle"
              size="sm"
              position="absolute"
              top={0}
              left={0}
              right={0}
              zIndex={1001}
            >
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>

            <Flex minH="100vh" align="center" justify="center" p="4">
              <Card.Root shadow="lg" borderRadius="2xl" maxW="md" w="full">
                <CardBody>
                  <Flex direction="column" gap="4">
                    <Flex align="center" gap="3">
                      <Spinner />
                      <Box>
                        <Text fontWeight="bold">Auto-coding…</Text>
                        <Text fontSize="sm" color="gray.600">
                          {autoCodeMsg || "Please wait while models run."}
                        </Text>
                      </Box>
                    </Flex>

                    {Object.entries(projectProgress).length > 0 && (
                      <Flex direction="column" gap="3">
                        {Object.entries(projectProgress).map(([projectName, { processed, total }]) => (
                          <Box key={projectName}>
                            <Flex justify="space-between" mb="2" align="center">
                              <Text fontSize="sm" fontWeight="medium">{projectName}</Text>
                              <Text fontSize="xs" color="gray.600">{processed}/{total}</Text>
                            </Flex>
                            <Progress.Root
                              value={total > 0 ? (processed / total) * 100 : 0}
                              min={0}
                              max={100}
                              colorPalette="blue"
                              size="sm"
                            >
                              <Progress.Track>
                                <Progress.Range />
                              </Progress.Track>
                            </Progress.Root>
                          </Box>
                        ))}
                      </Flex>
                    )}
                  </Flex>
                </CardBody>
              </Card.Root>
            </Flex>
          </Box>
        </Portal>
      )}

      <Flex gap="2" mb="4" wrap="wrap">
        {projectList.map((projectName) => {
          const projData = projectData[projectName];
          const projSegmentCount = projData?.attrs.length ?? 0;
          const isActive = activeTab === projectName;
          return (
            <Button
              key={projectName}
              onClick={() => setActiveTab(projectName)}
              variant={isActive ? "solid" : "outline"}
              colorPalette={isActive ? "blue" : "gray"}
              size="md"
            >
              {projectName} ({projSegmentCount})
            </Button>
          );
        })}
        <Button
          onClick={() => setActiveTab("coding-guide")}
          variant={isShowingCodingGuide ? "solid" : "outline"}
          colorPalette={isShowingCodingGuide ? "blue" : "gray"}
          size="md"
        >
          Coding Guide
        </Button>
        <Button
          onClick={() => window.open("https://irap.org/cyclerap/", "_blank", "noopener,noreferrer")}
          variant="outline"
          colorPalette="gray"
          size="md"
        >
          CycleRAP
        </Button>

        {returnToAnalysis && (
          <Button
            ml="auto"
            variant="ghost"
            colorPalette="blue"
            size="sm"
            onClick={onBackToAnalysis}
          >
            ← Back to Path Analysis
          </Button>
        )}

        <ExitConfirmationDialog
          open={isSaveDialogOpen}
          onCancel={() => setIsSaveDialogOpen(false)}
          onDiscardAndExit={onDiscardAndExit}
          onSaveAndExit={onSaveAndExit}
          isSaving={isSaving}
        />
      </Flex>

      <Flex justify="space-between" align="center" mb="3">
        <Flex align="center" gap="3">
          <Box>
            <Text fontSize="lg" fontWeight="bold">{detail?.name ?? currentProjectName}</Text>
            {detail?.latest && (
              <Text fontSize="sm" color="gray.600">Latest version: {detail.latest}</Text>
            )}
          </Box>
          <Flex align="center" gap="2">
            <Text fontSize="sm" fontWeight="bold">Segments Verified:</Text>
            <NumberInput.Root
              maxW="80px"
              min={0}
              max={len || 0}
              value={segmentInput}
              onValueChange={(e) => setSegmentInput(e.value)}
            >
              <NumberInput.Control />
              <NumberInput.Input
                placeholder="0"
                onBlur={() => commitSegment(segmentInput, true)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.currentTarget.blur();
                  }
                }}
              />
            </NumberInput.Root>
            <span style={{ fontSize: "18px", minWidth: "50px" }}>
              {len > 0
                ? `${((currentData.verifiedSegmentCount ?? 0) / len * 100).toFixed(1)}%`
                : "0%"}
            </span>
          </Flex>

          <Flex align="center" gap="2">
            <Text fontSize="sm" fontWeight="bold">Segments Autocoded:</Text>
            <NumberInput.Root
              maxW="80px"
              min={0}
              max={len || 0}
              value={autocodedSegmentInput}
              onValueChange={(e) => setAutocodedSegmentInput(e.value)}
            >
              <NumberInput.Control />
              <NumberInput.Input
                placeholder="0"
                onBlur={() => commitAutocodedSegment(autocodedSegmentInput, true)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.currentTarget.blur();
                  }
                }}
              />
            </NumberInput.Root>
            <span style={{ fontSize: "18px", minWidth: "50px" }}>
              {len > 0
                ? `${((currentData.autocodedSegmentCount ?? 0) / len * 100).toFixed(1)}%`
                : "0%"}
            </span>
          </Flex>
        </Flex>

        <Flex align="center" gap="3">
          <Text fontSize="sm" color="gray.600">
            {len > 0 ? `${currentPage} / ${len}` : "0 / 0"}
          </Text>

          <NumberInput.Root
            maxW="120px"
            min={1}
            max={len || 1}
            value={pageInput}
            onValueChange={(e) => {
              const val = e.value.replace(/^0+/, "");
              setPageInput(val);
            }}
          >
            <NumberInput.Control />
            <NumberInput.Input
              onBlur={() => commitPage(pageInput, true)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.currentTarget.blur();
                }
              }}
            />
          </NumberInput.Root>
        </Flex>
      </Flex>

      <Grid
        templateColumns={{ base: "1fr", md: "2fr 1fr" }}
        gap="16px"
      >
        <GridItem
          display="flex"
          flexDirection="column"
          minH={`${PANEL_HEIGHT}px`}
          gap="4"
        >
          <Box
            bg="white"
            borderRadius="md"
            p="1"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
            flexShrink={0}
          >
            <SegmentScoresCard
              scores={scores[currentIndex] || null}
              projectContributors={projectContributors}
              onContributorClick={handleContributorClick}
            />
          </Box>

          <Box flex="1" minH={0}>
            <ImagePanel
              projectName={currentProjectName!}
              imageRef={imgRef}
              panelHeight={PANEL_HEIGHT}
            />
          </Box>

          <Flex
            flex="0 0 auto"
            h="56px"
            w="100%"
            minW={0}
            align="center"
            gap="4"
            pt="0"
            position="relative"
            zIndex={1}
            bg="bg"
          >
            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="outline"
              onClick={() => gotoPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>

            {cameFromPathAnalysis && (
              <Button
                flex="1"
                minW={0}
                size="sm"
                colorPalette="green"
                variant={currentSegmentVerified ? "solid" : "outline"}
                onClick={toggleCurrentSegmentVerified}
                title={currentSegmentVerified ? "Click to unmark this segment" : "Mark this segment as reviewed"}
              >
                {currentSegmentVerified ? "✓ Verified" : "Mark Verified"}
              </Button>
            )}

            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="solid"
              onClick={() => gotoPage(currentPage + 1)}
              disabled={currentPage >= len}
            >
              Next
            </Button>
          </Flex>
        </GridItem>

        <GridItem
          display="flex"
          flexDirection="column"
          gap="4"
        >
          <Box flex="1" minH={0} display="flex" flexDirection="column">
            <AttributesPanel
              row={currentAttr}
              originalRow={originalCurrentAttr}
              mappings={attrMappings}
              panelHeight={undefined} // Let it fill the parent
              flex={1}
              onChange={onAttrChange}
              onEdit={onEdit}
              changedFields={changedFieldsByRow[currentIndex] || []}
              fieldSources={fieldSourcesByRow[currentIndex] || {}}
              highlightColor="yellow"
              activeGroupTab={activeAttributeGroupTab}
              onEditOptions={(field) => {
                const raw = currentAttr?.[field];
                let currentValue = raw != null ? String(raw) : null;
                if (field === "Issue Type (Slippery)" && !currentValue) {
                  currentValue = "Algae";
                }
                const delineationVal = currentAttr?.["Delineation"];
                const delineationNotPresent = field === "Delineation Type"
                  && (delineationVal === 2 || delineationVal === "2");
                setEditingOptions({ field, currentValue, delineationNotPresent });
              }}
            />
          </Box>
        </GridItem>

        <GridItem colSpan={{ base: 1, md: 2 }}>
          <GeoDataPanel
            projectName={currentProjectName!}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => gotoPage(i + 1)}
            scores={scores}
            filterContext={filterContext}
            verifiedByProject={cameFromPathAnalysis ? verifiedByProject : undefined}
            onDataChange={refreshCurrentProject}
            curvData={curvData}
            widthM={widthData?.width ?? null}
            grade={(currentAttr?.["Grade"] as number | null) ?? null}
            gradientPct={(currentAttr?.["Gradient %"] as number | null) ?? null}
            gradientStatus={(currentAttr?.["Gradient Status"] as string | null) ?? null}
            showCurvatureOverlay={showCurvatureOverlay}
            onToggleCurvatureOverlay={() => setShowCurvatureOverlay(v => !v)}
          />
        </GridItem>

        {filterContext?.legend && (
          <GridItem colSpan={{ base: 1, md: 2 }}>
            <Flex
              align="center"
              gap="3"
              px="3"
              py="2"
              bg="gray.50"
              borderRadius="md"
              borderWidth="1px"
              borderColor="gray.200"
              flexWrap="wrap"
              _dark={{ bg: "gray.800", borderColor: "gray.600" }}
            >
              <Text fontSize="xs" fontWeight="semibold" color="gray.500" flexShrink={0} _dark={{ color: "gray.400" }}>
                Filter:
              </Text>
              <Text fontSize="xs" fontWeight="medium" color="gray.700" flexShrink={0} _dark={{ color: "gray.200" }}>
                {filterContext.legend.attribute}
              </Text>
              {filterContext.legend.entries.map(({ category, color }) => (
                <Flex key={category} align="center" gap="1.5">
                  <Box w="10px" h="10px" borderRadius="full" flexShrink={0} style={{ backgroundColor: color }} />
                  <Text fontSize="xs" color="gray.700" _dark={{ color: "gray.300" }}>{category}</Text>
                </Flex>
              ))}
            </Flex>
          </GridItem>
        )}

        <GridItem colSpan={{ base: 1, md: 2 }}>
          <AutocodeValidation
            projectName={currentProjectName!}
            attributes={attrs}
            panelHeight={350}
          />
        </GridItem>
      </Grid>

      <CodingAttributeModals {...vm} />
    </Box>
  );
}
