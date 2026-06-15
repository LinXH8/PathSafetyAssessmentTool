import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Flex, Text, Button, Image as ChakraImage, Spinner, IconButton } from "@chakra-ui/react";
import { LuUpload, LuTrash2, LuImagePlus } from "react-icons/lu";
import { toaster } from "../../../components/ui/toaster";

interface Props {
  projectName: string;
  segmentIndex: number;
}

export default function PostTreatmentImageUpload({ projectName, segmentIndex }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImage = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const url = `/api/projects/${encodeURIComponent(projectName)}/segments/${segmentIndex}/post-treatment-image`;
      const res = await fetch(url);
      if (res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          setImageUrl(null);
        } else {
          // Append a timestamp to avoid caching issues when replacing
          setImageUrl(`${url}?t=${new Date().getTime()}`);
        }
      } else {
        setImageUrl(null);
      }
    } catch (e) {
      setImageUrl(null);
    } finally {
      setLoading(false);
    }
  }, [projectName, segmentIndex]);

  useEffect(() => {
    fetchImage();
  }, [fetchImage]);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toaster.create({ title: "Invalid file type", description: "Please upload an image.", type: "error" });
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/segments/${segmentIndex}/post-treatment-image`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        toaster.create({ title: "Success", description: "Image uploaded successfully.", type: "success" });
        await fetchImage();
      } else {
        toaster.create({ title: "Error", description: "Failed to upload image.", type: "error" });
      }
    } catch (e) {
      toaster.create({ title: "Error", description: "Failed to upload image.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/segments/${segmentIndex}/post-treatment-image`, {
        method: "DELETE",
      });
      if (res.ok) {
        toaster.create({ title: "Success", description: "Image deleted successfully.", type: "success" });
        setImageUrl(null);
      } else {
        toaster.create({ title: "Error", description: "Failed to delete image.", type: "error" });
      }
    } catch (err) {
      toaster.create({ title: "Error", description: "Failed to delete image.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Only handle paste if we don't already have an image or if we're explicitly focused
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        handleUpload(e.clipboardData.files[0]);
      }
    },
    [handleUpload]
  );

  useEffect(() => {
    // Attach paste event listener to the window so user can just Ctrl+V
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [onPaste]);

  return (
    <Box mt={4} width="100%" height="100%" display="flex" flexDirection="column" flex="1" minH={0}>
      <Text fontSize="sm" fontWeight="bold" mb={2} flexShrink={0}>
        Post-Treatment Artistic Impression
      </Text>
      <Box
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !imageUrl && fileInputRef.current?.click()}
        borderWidth="2px"
        borderStyle={imageUrl ? "solid" : "dashed"}
        borderColor={isDragging ? "blue.500" : "gray.300"}
        borderRadius="md"
        position="relative"
        flex="1"
        minH="150px"
        bg={isDragging ? "blue.50" : imageUrl ? "black" : "gray.50"}
        _dark={{ bg: isDragging ? "blue.900" : imageUrl ? "black" : "gray.800", borderColor: "gray.600" }}
        cursor={imageUrl ? "default" : "pointer"}
        overflow="hidden"
        transition="all 0.2s"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <input
          type="file"
          accept="image/*"
          hidden
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleUpload(e.target.files[0]);
            }
          }}
        />

        {loading ? (
          <Spinner size="xl" color="blue.500" />
        ) : imageUrl ? (
          <>
            <ChakraImage
              src={imageUrl}
              alt="Post-Treatment"
              objectFit="contain"
              w="100%"
              h="100%"
            />
            <Flex
              position="absolute"
              top={2}
              right={2}
              gap={2}
              bg="rgba(0,0,0,0.5)"
              p={1}
              borderRadius="md"
            >
              <IconButton
                aria-label="Replace Image"
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: "whiteAlpha.300" }}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <LuImagePlus />
              </IconButton>
              <IconButton
                aria-label="Delete Image"
                size="sm"
                variant="ghost"
                color="red.300"
                _hover={{ bg: "whiteAlpha.300" }}
                onClick={handleDelete}
              >
                <LuTrash2 />
              </IconButton>
            </Flex>
          </>
        ) : (
          <Flex direction="column" align="center" color="gray.500">
            <LuUpload size={40} mb={2} />
            <Text fontSize="sm">Drag & drop an image here</Text>
            <Text fontSize="xs">or click to browse</Text>
            <Text fontSize="xs" mt={1}>or paste (Ctrl+V) from clipboard</Text>
          </Flex>
        )}
      </Box>
    </Box>
  );
}
