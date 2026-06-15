import { useState, useRef, useEffect, useCallback } from "react";
import { Button, Flex, Spacer, Grid, GridItem, Dialog, Portal, Box, Text } from "@chakra-ui/react";
import { LuWandSparkles } from "react-icons/lu";
import { GROUP_ORDER, GROUP_RULES, KEY_ALIASES, type AttributeGroup } from "../../../constants/autocodeAttributes";

type CodingSidebarProps = {
  projectName: string;
  onSave: () => Promise<void> | void;
  onExit: () => void;

  // Auto-coding callbacks
  onAutoCodeOne: () => Promise<void> | void;
  onAutoCodeAll: () => Promise<void> | void;
  onAutoCodeAllProjects: () => Promise<void> | void;
  onAutoCodeByAttribute: (fields: string[]) => void;
};

/** Flat list of all { displayName, group } entries */
const ALL_ITEMS: { displayName: string; group: AttributeGroup }[] = GROUP_ORDER.flatMap((g) =>
  GROUP_RULES[g].map((d) => ({ displayName: d, group: g }))
);

/** Short group labels for badges */
const GROUP_SHORT: Record<AttributeGroup, string> = {
  "Facility configuration": "Config",
  "Facility clear width": "Width",
  "Facility surface conditions": "Surface",
  "Intersection": "Intersect",
  "Flow & Speed": "Flow",
};

type PendingAction =
  | { type: "one" }
  | { type: "all" }
  | { type: "allProjects" }
  | { type: "byAttribute"; fields: string[] };

export default function CodingSidebar({
  onSave,
  onExit,
  onAutoCodeOne,
  onAutoCodeAll,
  onAutoCodeAllProjects,
  onAutoCodeByAttribute,
}: CodingSidebarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Auto-focus search when panel opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // Filtered items based on search query
  const filteredItems = query.trim()
    ? ALL_ITEMS.filter((item) =>
        item.displayName.toLowerCase().includes(query.toLowerCase()) ||
        item.group.toLowerCase().includes(query.toLowerCase())
      )
    : null; // null = show grouped view

  const toggleField = useCallback((displayName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(displayName)) next.delete(displayName);
      else next.add(displayName);
      return next;
    });
  }, []);

  const selectAllInGroup = useCallback((group: AttributeGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      GROUP_RULES[group].forEach((n) => next.add(n));
      return next;
    });
  }, []);

  const deselectAllInGroup = useCallback((group: AttributeGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      GROUP_RULES[group].forEach((n) => next.delete(n));
      return next;
    });
  }, []);

  const handleSelectAll = () => setSelected(new Set(ALL_ITEMS.map((i) => i.displayName)));
  const handleClearAll = () => setSelected(new Set());

  const handleRun = () => {
    const realKeys = [...selected].map((d) => KEY_ALIASES[d] ?? d);
    if (realKeys.length === 0) return;
    setOpen(false);
    setPendingAction({ type: "byAttribute", fields: realKeys });
  };

  const handleClose = () => setOpen(false);

  const handleConfirm = () => {
    if (!pendingAction) return;
    setPendingAction(null);
    if (pendingAction.type === "one") onAutoCodeOne();
    else if (pendingAction.type === "all") onAutoCodeAll();
    else if (pendingAction.type === "allProjects") onAutoCodeAllProjects();
    else if (pendingAction.type === "byAttribute") onAutoCodeByAttribute(pendingAction.fields);
  };

  const confirmLabel =
    pendingAction?.type === "one"
      ? "Auto-code this segment?"
      : pendingAction?.type === "all"
      ? "Auto-code all segments in this project?"
      : pendingAction?.type === "allProjects"
      ? "Auto-code all segments across all projects?"
      : pendingAction?.type === "byAttribute"
      ? `Auto-code ${pendingAction.fields.length} attribute(s) for all segments?`
      : "";

  return (
    <Flex direction="column" h="100%">
      <Grid
        w="100%"
        minW={0}
        templateColumns="repeat(2, minmax(0, 1fr))"
        columnGap={2}
        rowGap={3}
        mt="auto"
      >
        <Button onClick={() => setPendingAction({ type: "one" })} w="100%" size="sm" variant="outline" colorPalette="gray">
          Auto-code
        </Button>

        <Button onClick={() => setPendingAction({ type: "all" })} w="100%" size="sm" variant="outline" colorPalette="gray">
          Auto-code all
        </Button>

        <GridItem colSpan={2}>
          <Button onClick={() => setOpen(true)} w="100%" size="sm" variant="outline" colorPalette="teal">
            Auto-code (By Attribute)
          </Button>
        </GridItem>

        <GridItem colSpan={2}>
          <Button onClick={() => setPendingAction({ type: "allProjects" })} w="100%" size="sm" variant="outline" colorPalette="blue">
            Autocode All Projects
          </Button>
        </GridItem>
      </Grid>

      <Spacer />

      <Grid
        w="100%"
        minW={0}
        templateColumns="repeat(2, minmax(0, 1fr))"
        columnGap={2}
        rowGap={3}
        mt="auto"
      >
        <GridItem>
          <Button onClick={onSave} w="100%" size="sm" variant="solid" colorPalette="gray">
            Save
          </Button>
        </GridItem>
        <GridItem>
          <Button onClick={onExit} w="100%" size="sm" variant="subtle" colorPalette="gray">
            Exit
          </Button>
        </GridItem>
      </Grid>

      {/* Autocode Confirmation Modal */}
      <Dialog.Root role="alertdialog" open={!!pendingAction} onOpenChange={(e) => !e.open && setPendingAction(null)} size="md">
        <Portal>
          <Dialog.Backdrop bg="blackAlpha.700" backdropFilter="blur(4px)" />
          <Dialog.Positioner>
            <Dialog.Content 
              bg={{ base: "white", _dark: "gray.900" }} 
              borderColor={{ base: "gray.200", _dark: "gray.800" }} 
              borderWidth="1px"
              boxShadow={{
                base: "0 20px 40px -10px rgba(0,0,0,0.1), 0 0 20px rgba(42, 157, 143, 0.1)",
                _dark: "0 20px 40px -10px rgba(0,0,0,0.8), 0 0 20px rgba(42, 157, 143, 0.15)"
              }}
              borderRadius="xl"
            >
              <Dialog.Header>
                <Dialog.Title display="flex" alignItems="center" gap={2} fontSize="lg" fontWeight="bold">
                  <Box color={{ base: "teal.600", _dark: "teal.400" }}><LuWandSparkles /></Box>
                  Start Autocoding?
                </Dialog.Title>
                <Dialog.CloseTrigger />
              </Dialog.Header>
              <Dialog.Body>
                <Text color={{ base: "gray.800", _dark: "gray.300" }} fontSize="md">
                  {confirmLabel}
                </Text>
                <Text color={{ base: "orange.600", _dark: "orange.400" }} fontSize="sm" mt={2} fontWeight="medium">
                  Warning: Autocoding will overwrite any manually verified changes for these attributes. Are you sure you want to proceed?
                </Text>
              </Dialog.Body>
              <Dialog.Footer>
                <Button variant="ghost" onClick={() => setPendingAction(null)} colorPalette="gray">
                  Back to Coding Page
                </Button>
                <Button 
                  colorPalette="teal" 
                  onClick={handleConfirm}
                  boxShadow={{
                    base: "0 4px 14px 0 rgba(42, 157, 143, 0.2)",
                    _dark: "0 4px 14px 0 rgba(42, 157, 143, 0.39)"
                  }}
                  _hover={{ 
                    transform: "translateY(-1px)", 
                    boxShadow: {
                      base: "0 6px 20px rgba(42, 157, 143, 0.3)",
                      _dark: "0 6px 20px rgba(42, 157, 143, 0.4)"
                    }
                  }}
                  transition="all 0.2s"
                >
                  Start Autocoding
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Attribute Combobox Panel */}
      {open && (
        <div style={overlayStyle} onClick={handleClose}>
          <div style={panelStyle} onClick={(e) => e.stopPropagation()}>

            {/* Search input row */}
            <div style={searchRowStyle}>
              <span style={searchIconStyle}>🔍</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search attributes..."
                style={searchInputStyle}
              />
              {query && (
                <button style={clearInputBtnStyle} onClick={() => setQuery("")}>✕</button>
              )}
              <button style={closeBtnStyle} onClick={handleClose}>✕</button>
            </div>

            {/* Toolbar: select all / clear / count */}
            <div style={toolbarStyle}>
              <button style={linkBtnStyle} onClick={handleSelectAll}>All</button>
              <span style={{ color: "#555" }}>·</span>
              <button style={linkBtnStyle} onClick={handleClearAll}>None</button>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#777" }}>
                {selected.size} / {ALL_ITEMS.length} selected
              </span>
            </div>

            {/* Scrollable list */}
            <div style={listStyle}>
              {filteredItems !== null ? (
                /* ── Search results: flat list with group badge ── */
                filteredItems.length === 0 ? (
                  <div style={emptyStyle}>No attributes match "{query}"</div>
                ) : (
                  filteredItems.map(({ displayName, group }) => (
                    <label key={displayName} style={itemRowStyle(selected.has(displayName))}>
                      <input
                        type="checkbox"
                        checked={selected.has(displayName)}
                        onChange={() => toggleField(displayName)}
                        style={checkboxStyle}
                      />
                      <span style={{ flex: 1, fontSize: 12 }}>{displayName}</span>
                      <span style={groupBadgeStyle}>{GROUP_SHORT[group]}</span>
                    </label>
                  ))
                )
              ) : (
                /* ── Default: grouped view ── */
                GROUP_ORDER.map((group) => {
                  const fields = GROUP_RULES[group];
                  const groupSelectedCount = fields.filter((f) => selected.has(f)).length;
                  const allGroupSelected = groupSelectedCount === fields.length;

                  return (
                    <div key={group}>
                      {/* Group header */}
                      <div style={groupHeaderStyle}>
                        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>
                          {group}
                        </span>
                        <span style={{ fontSize: 10, color: "#666", marginRight: 6 }}>
                          {groupSelectedCount}/{fields.length}
                        </span>
                        <button
                          style={linkBtnStyle}
                          onClick={() => allGroupSelected ? deselectAllInGroup(group) : selectAllInGroup(group)}
                        >
                          {allGroupSelected ? "None" : "All"}
                        </button>
                      </div>

                      {/* Fields in group */}
                      {fields.map((displayName) => (
                        <label key={displayName} style={itemRowStyle(selected.has(displayName))}>
                          <input
                            type="checkbox"
                            checked={selected.has(displayName)}
                            onChange={() => toggleField(displayName)}
                            style={checkboxStyle}
                          />
                          <span style={{ flex: 1, fontSize: 12 }}>{displayName}</span>
                        </label>
                      ))}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={footerStyle}>
              <button style={cancelBtnStyle} onClick={handleClose}>Cancel</button>
              <button
                style={selected.size === 0 ? disabledRunBtnStyle : runBtnStyle}
                onClick={handleRun}
                disabled={selected.size === 0}
              >
                Run ({selected.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </Flex>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  bottom: 0,
  width: "var(--sidebar-w)",
  background: "rgba(0,0,0,0.55)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const panelStyle: React.CSSProperties = {
  background: "#1c1c1c",
  border: "1px solid #3a3a3a",
  borderRadius: 10,
  width: "100%",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  color: "#ddd",
  boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  overflow: "hidden",
};

const searchRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 10px 8px",
  borderBottom: "1px solid #2e2e2e",
};

const searchIconStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.5,
  flexShrink: 0,
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  background: "#2a2a2a",
  border: "1px solid #444",
  borderRadius: 6,
  color: "#e0e0e0",
  fontSize: 13,
  padding: "5px 8px",
  outline: "none",
  minWidth: 0,
};

const clearInputBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#777",
  cursor: "pointer",
  fontSize: 12,
  padding: "0 2px",
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 15,
  padding: "0 2px",
  flexShrink: 0,
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 12px",
  borderBottom: "1px solid #272727",
  background: "#191919",
};

const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#4ab8ff",
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
};

const emptyStyle: React.CSSProperties = {
  padding: "20px 16px",
  fontSize: 12,
  color: "#666",
  textAlign: "center",
};

const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "8px 12px 4px",
  background: "#161616",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const itemRowStyle = (isSelected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 12px",
  cursor: "pointer",
  background: isSelected ? "rgba(74,184,255,0.06)" : "transparent",
  transition: "background 0.1s",
});

const checkboxStyle: React.CSSProperties = {
  cursor: "pointer",
  flexShrink: 0,
  accentColor: "#4ab8ff",
};

const groupBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 5px",
  borderRadius: 3,
  background: "#2a3a4a",
  color: "#7ab8dd",
  flexShrink: 0,
  fontWeight: 600,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderTop: "1px solid #2e2e2e",
  background: "#191919",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "5px 14px",
  borderRadius: 5,
  border: "1px solid #484848",
  background: "transparent",
  color: "#bbb",
  cursor: "pointer",
  fontSize: 13,
};

const runBtnStyle: React.CSSProperties = {
  padding: "5px 16px",
  borderRadius: 5,
  border: "none",
  background: "#2a9d8f",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const disabledRunBtnStyle: React.CSSProperties = {
  ...runBtnStyle,
  background: "#383838",
  color: "#666",
  cursor: "not-allowed",
};


