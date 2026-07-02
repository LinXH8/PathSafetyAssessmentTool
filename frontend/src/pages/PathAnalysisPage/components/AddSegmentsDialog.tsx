import {
    Dialog,
    Button,
    VStack,
    Input,
    Text,
    Field,
    Portal,
    createListCollection,
    Tabs,
    Box,
    Combobox,
} from "@chakra-ui/react";
import { useState, useEffect, type KeyboardEvent } from "react";
import { fetchProjectList, copySegments, checkCollisions } from "../../../api";
import { toaster } from "../../../components/ui/toaster";
import { getTagColor } from "../../Projects/tagColor";
import "../../Projects/components/EditProjectModal.css";

interface SourceProjectData {
    projectName: string;
    indices: number[];
}

interface AddSegmentsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    sources: SourceProjectData[];
    onSuccess: () => void;
}

export function AddSegmentsDialog({
    isOpen,
    onClose,
    sources,
    onSuccess
}: AddSegmentsDialogProps) {
    const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
    const [newProjectName, setNewProjectName] = useState("");
    const [existingProject, setExistingProject] = useState("");
    const [projects, setProjects] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // Tag States for New Project
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState("");
    const [existingTags, setExistingTags] = useState<string[]>([]);
    const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);

    // Project Combobox State
    const [existingProjectInput, setExistingProjectInput] = useState("");
    const [projectComboboxOpen, setProjectComboboxOpen] = useState(false);

    const [collisionConfirmOpen, setCollisionConfirmOpen] = useState(false);
    const [collisionCount, setCollisionCount] = useState(0);

    const totalSegments = sources.reduce((sum, s) => sum + s.indices.length, 0);
    const sourceProjectNames = sources.map(s => s.projectName);

    // Load available projects and tags
    useEffect(() => {
        if (isOpen) {
            fetchProjectList()
                .then((res) => {
                    // Projects list
                    const available = res.projects
                        .map(p => p.name)
                        .filter(n => !sourceProjectNames.includes(n)); // Exclude source projects from target list? Actually maybe allowed to copy to self? Usually not.
                    setProjects(available);
                    if (available.length > 0) {
                        setExistingProject(available[0]);
                        setProjectMode("existing");
                    } else {
                        setProjectMode("new");
                    }

                    // Extract unique tags
                    const tagSet = new Set<string>();
                    res.projects.forEach(p => {
                        p.tags?.forEach(tag => tagSet.add(tag));
                    });
                    setExistingTags(Array.from(tagSet).sort());
                })
                .catch(console.error);
        } else {
            // Force cleanup of pointer-events lock caused by Chakra UI Dialog bugs
            setTimeout(() => {
                document.body.style.pointerEvents = "auto";
                document.documentElement.style.pointerEvents = "auto";
                document.body.removeAttribute("data-scroll-locked");
                document.documentElement.removeAttribute("data-scroll-locked");
            }, 400);
        }
    }, [isOpen]);

    const commitTag = (rawTag: string) => {
        const trimmedTag = rawTag.trim();
        if (trimmedTag) {
            setTags((current) => current.includes(trimmedTag) ? current : [...current, trimmedTag]);
        }
        setTagInput("");
        setTagSuggestionsOpen(true);
    };

    const filteredTagSuggestions = existingTags.filter((tag) => {
        const query = tagInput.trim().toLowerCase();
        return !tags.includes(tag) && (!query || tag.toLowerCase().includes(query));
    });

    // Tag Handlers
    const handleTagInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "," || e.key === "Enter") {
            e.preventDefault();
            commitTag(tagInput);
        } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
            setTags(tags.slice(0, -1));
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter((t) => t !== tagToRemove));
    };

    const performCopy = async (replace: boolean) => {
        const isNew = projectMode === "new";
        const target = isNew ? newProjectName : existingProject;

        try {
            setSubmitting(true);

            // Loop through sources and copy sequentially
            for (const source of sources) {
                await copySegments(
                    source.projectName,
                    target,
                    source.indices,
                    isNew && source === sources[0], // Only create new project for the first source, subsequent are appends
                    replace,
                    isNew ? tags : [] // Pass tags only if new project (only applied on creation)
                );
            }

            toaster.create({
                title: "Success",
                description: `Successfully copied ${totalSegments} segments to ${target}.`,
                type: "success"
            });
            onSuccess();
            onClose();
            setCollisionConfirmOpen(false);
        } catch (e: any) {
            toaster.create({
                title: "Error",
                description: e.message || "Failed to copy segments.",
                type: "error"
            });
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        const target = projectMode === "new" ? newProjectName : existingProject;

        if (!target) {
            toaster.create({ title: "Validation Error", description: "Please specify a project name.", type: "error" });
            return;
        }

        if (projectMode === "new" && target.includes("_")) {
            toaster.create({ title: "Validation Error", description: "Project name cannot contain underscores (_).", type: "error" });
            return;
        }

        try {
            setSubmitting(true);

            // Check for collisions ONLY if copying to existing project
            if (projectMode === "existing") {
                let totalCollisions = 0;

                // Check collisions for each source
                for (const source of sources) {
                    const checkRes = await checkCollisions(source.projectName, target, source.indices);
                    if (checkRes.collisions) {
                        totalCollisions += checkRes.collisions.length;
                    }
                }

                if (totalCollisions > 0) {
                    setCollisionCount(totalCollisions);
                    setCollisionConfirmOpen(true);
                    setSubmitting(false); // Stop loading, wait for user confirmation
                    return;
                }
            }

            // No collisions or new project, proceed directly
            await performCopy(false);

        } catch (e: any) {
            toaster.create({
                title: "Error",
                description: e.message || "Failed to check for collisions.",
                type: "error"
            });
            setSubmitting(false);
        }
    };

    const handleConfirmReplace = async () => {
        await performCopy(true);
    };

    const filteredProjects = projects.filter(p =>
        p.toLowerCase().includes(existingProjectInput.toLowerCase())
    );
    const projectCollection = createListCollection({ items: filteredProjects.map(p => ({ label: p, value: p })) });
    return (
        <>
            <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && onClose()}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Add Segments to Project</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <VStack gap="4" align="stretch">
                                    <Text fontSize="sm" color="gray.600">
                                        You are about to copy <b>{totalSegments}</b> segments from <b>{sources.length}</b> {sources.length === 1 ? 'project' : 'projects'}:
                                    </Text>
                                    <Box maxH="100px" overflowY="auto" pl="2" borderLeft="2px solid" borderColor="gray.200">
                                        {sources.map(s => (
                                            <Text fontSize="xs" key={s.projectName}>
                                                • <b>{s.projectName}</b>: {s.indices.length} segments
                                            </Text>
                                        ))}
                                    </Box>

                                    <Tabs.Root
                                        value={projectMode}
                                        onValueChange={(e) => setProjectMode(e.value as "existing" | "new")}
                                        variant="line"
                                    >
                                        <Tabs.List>
                                            <Tabs.Trigger value="existing" disabled={projects.length === 0}>
                                                Existing Project
                                            </Tabs.Trigger>
                                            <Tabs.Trigger value="new">
                                                New Project
                                            </Tabs.Trigger>
                                        </Tabs.List>

                                        <Tabs.Content value="existing" pt="4">
                                            <Field.Root>
                                                <Field.Label>Select Project</Field.Label>
                                                <Combobox.Root
                                                    collection={projectCollection}
                                                    value={existingProject ? [existingProject] : []}
                                                    onValueChange={(e) => {
                                                        setExistingProject(e.value[0]);
                                                        if (e.value[0]) setExistingProjectInput(e.value[0]);
                                                    }}
                                                    inputValue={existingProjectInput}
                                                    onInputValueChange={(e) => setExistingProjectInput(e.inputValue)}
                                                    open={projectComboboxOpen}
                                                    onOpenChange={(details) => setProjectComboboxOpen(details.open)}
                                                >
                                                    <Combobox.Control onClick={() => setProjectComboboxOpen(true)}>
                                                        <Combobox.Input placeholder="Select or type project name" />
                                                        <Combobox.IndicatorGroup>
                                                            <Combobox.Trigger />
                                                        </Combobox.IndicatorGroup>
                                                    </Combobox.Control>
                                                    <Portal>
                                                        <Combobox.Positioner>
                                                            <Combobox.Content zIndex={2000} maxH="300px" overflowY="auto">
                                                                <Combobox.Empty>No projects found</Combobox.Empty>
                                                                {projectCollection.items.map((item) => (
                                                                    <Combobox.Item item={item} key={item.value}>
                                                                        {item.label}
                                                                    </Combobox.Item>
                                                                ))}
                                                            </Combobox.Content>
                                                        </Combobox.Positioner>
                                                    </Portal>
                                                </Combobox.Root>
                                            </Field.Root>
                                        </Tabs.Content>

                                        <Tabs.Content value="new" pt="4">
                                            <VStack gap="4" align="stretch">
                                                <Field.Root>
                                                    <Field.Label>New Project Name</Field.Label>
                                                    <Input
                                                        placeholder="Enter new project name (no underscores)"
                                                        value={newProjectName}
                                                        onChange={(e) => setNewProjectName(e.target.value)}
                                                    />
                                                </Field.Root>

                                                <Field.Root>
                                                    <Field.Label>Tags (Optional)</Field.Label>
                                                    <Box className="tag-input-container">
                                                        <Box className="tag-input-wrapper">
                                                            {tags.map((tag) => (
                                                                <Box
                                                                    key={tag}
                                                                    className="tag-chip"
                                                                    style={{ backgroundColor: getTagColor(tag) }}
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
                                                                        zIndex={2000}
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
                                                        Press comma (,) or Enter to add a tag.
                                                    </Text>
                                                </Field.Root>
                                            </VStack>
                                        </Tabs.Content>
                                    </Tabs.Root>

                                </VStack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={onClose} disabled={submitting}>
                                    Cancel
                                </Button>
                                <Button onClick={handleSubmit} loading={submitting}>
                                    {projectMode === "new" ? "Create & Copy" : "Copy Segments"}
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Nested Confirmation Dialog for Collisions */}
            <Dialog.Root open={collisionConfirmOpen} onOpenChange={(e) => setCollisionConfirmOpen(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Duplicate Segments Detected</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Text>
                                    {collisionCount} segments already exist in "<b>{projectMode === "new" ? newProjectName : existingProject}</b>".
                                </Text>
                                <Text mt="4">
                                    Do you want to <b>REPLACE</b> them with the new segments? This action cannot be undone.
                                </Text>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setCollisionConfirmOpen(false)} disabled={submitting}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="red"
                                    onClick={handleConfirmReplace}
                                    loading={submitting}
                                >
                                    Replace Existing
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </>
    );
}
