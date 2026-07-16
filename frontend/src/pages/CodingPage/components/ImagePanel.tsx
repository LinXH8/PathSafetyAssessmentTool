import { Card, Heading, Box, Image, HStack, Button } from "@chakra-ui/react";
import { useState } from "react";
import { Slider } from "../../../components/ui/slider";
import MeasureModal from "./MeasureMode/MeasureModal";

type Props = {
  projectName?: string;
  imageRef?: string;
  panelHeight?: number; // px
  /** "contain" (default) shows the whole photo (may letterbox); "cover" fills the box. */
  fit?: "contain" | "cover";
};

export default function ImagePanel({
  projectName,
  imageRef,
  fit = "contain",
}: Props) {
  const [brightness, setBrightness] = useState(100);
  const [measureOpen, setMeasureOpen] = useState(false);

  return (
    <Card.Root
      h="100%"
      display="flex"
      flexDirection="column"
    >
      <Card.Header borderBottomWidth="1px" py={1} px={3}>
        <HStack gap={2} align="center" w="100%">
          <Heading size="sm">Image Brightness:</Heading>
          <Box flex={1} minW={0}>
            <Slider
              min={0}
              max={200}
              value={[brightness]}
              onValueChange={(details) => setBrightness(details.value[0])}
            />
          </Box>
          <Button
            size="xs"
            colorPalette="blue"
            variant="solid"
            flexShrink={0}
            disabled={!imageRef}
            onClick={() => setMeasureOpen(true)}
          >
            📐 Measure
          </Button>
        </HStack>
      </Card.Header>

      <Card.Body minH={0} p={0}>
        {imageRef ? (
          <Box
            h="100%"
            w="100%"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Image
              key={imageRef}
              as="img"
              src={`/api/projects/${encodeURIComponent(projectName ?? "")}/images/${encodeURIComponent(imageRef ?? "")}`}
              alt={imageRef ?? "image"}
              w={fit === "cover" ? "100%" : undefined}
              h={fit === "cover" ? "100%" : undefined}
              maxW="100%"
              maxH="100%"
              objectFit={fit}
              style={{ filter: `brightness(${brightness}%)` }}
            />
          </Box>
        ) : (
          <Box color="gray.400">No Image</Box>
        )}
      </Card.Body>

      {projectName && imageRef && (
        <MeasureModal
          projectName={projectName}
          imageRef={imageRef}
          open={measureOpen}
          onClose={() => setMeasureOpen(false)}
        />
      )}
    </Card.Root>
  );
}
