import { useState, useEffect, useMemo } from "react";
import {
  Button,
  Portal,
  Combobox,
  createListCollection,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { LuPencil } from "react-icons/lu";
import { fetchProjectList, type FileResponse } from "../../api";
import { matchesProjectSearch } from "../../utils/projectSearch";
import EditProjectModal from "../Projects/components/EditProjectModal";
import { getTagFillColor, getTagBorderColor } from "../Projects/tagColor";
import "../Projects/projects.css";

export default function TreatmentPage() {
  // Project list state
  const [projectList, setProjectList] = useState<FileResponse | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Filter states
  const [nameQuery, setNameQuery] = useState("");
  const [nameQueryComboboxOpen, setNameQueryComboboxOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [tagFilterInputValue, setTagFilterInputValue] = useState("");
  const [tagFilterComboboxOpen, setTagFilterComboboxOpen] = useState(false);

  // Selected Projects (multi-select)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Edit dialog state
  const [openEdit, setOpenEdit] = useState(false);
  const [editingProject, setEditingProject] = useState<any | null>(null);

  const navigate = useNavigate();

  // Fetch projects on mount
  useEffect(() => {
    setLoadingProjects(true);
    fetchProjectList()
      .then((data) => setProjectList(data))
      .catch(() => { })
      .finally(() => setLoadingProjects(false));
  }, []);

  // Listen for project verified status changes from coding page
  useEffect(() => {
    const handleVerificationUpdate = (event: CustomEvent) => {
      const { projectName, verified } = event.detail;


      // Update the project list directly
      setProjectList((prev) => {
        if (!prev) return prev;
        return {
          projects: prev.projects.map((p) =>
            p.name === projectName ? { ...p, verified } : p
          ),
        };
      });
    };

    window.addEventListener("psat:verified:updated", handleVerificationUpdate as EventListener);
    return () => window.removeEventListener("psat:verified:updated", handleVerificationUpdate as EventListener);
  }, []);

  // Process projects
  const projects = useMemo(() => {
    if (!projectList?.projects) return [];
    return projectList.projects
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectList]);

  // Get all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    projects.forEach(p => {
      p.tags?.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [projects]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = projects;
    if (nameQuery.trim()) list = list.filter((p) => matchesProjectSearch(p, nameQuery));
    if (tagFilter) list = list.filter((p) => p.tags?.includes(tagFilter));
    return list;
  }, [projects, nameQuery, tagFilter]);

  // Toggle project selection
  const onRowClick = (name: string) => {
    setSelected(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }

      return newSet;
    });
  };

  // Toggle select all projects
  const toggleSelectAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      // All are selected, deselect all
      setSelected(new Set());
    } else {
      // Select all
      setSelected(new Set(filtered.map(p => p.name)));
    }
  };

  const loadProject = async () => {
    if (selected.size === 0) {
      return;
    }
    const projectNames = Array.from(selected);
    // Encode each name, then join with ','
    // Since encodeURIComponent encodes ',' as '%2C', using ',' as separator is safe
    const joinedNames = projectNames.map(name => encodeURIComponent(name)).join(",");
    navigate(`/treatment/${joinedNames}`);
  };

  const handleEditSuccess = (newName: string, newTags: string[]) => {
    if (!editingProject) return;
    const oldName = editingProject.name;
    setProjectList((prev) => {
      if (!prev) return prev;
      return {
        projects: prev.projects.map((p) =>
          p.name === oldName ? { name: newName, tags: newTags } : p
        ),
      };
    });
    if (selected.has(oldName) && newName !== oldName) {
      setSelected(prev => {
        const newSet = new Set(prev);
        newSet.delete(oldName);
        newSet.add(newName);
        return newSet;
      });
    }
  };

  return (
    <div className="projects-root">
      {/* Search Panel */}
      <div className="search-panel">
        <div className="search-row">
          <div className="search-item">
            <label htmlFor="nameQuery">Search by project or road</label>
            <Combobox.Root
              collection={createListCollection({
                items: projects.map(p => ({ label: p.name, value: p.name }))
              })}
              inputValue={nameQuery}
              onInputValueChange={({ inputValue }) => setNameQuery(inputValue)}
              open={nameQueryComboboxOpen}
              onOpenChange={(details) => {
                // Keep dropdown open if there's text in the field
                if (nameQuery.length > 0) {
                  setNameQueryComboboxOpen(true);
                } else {
                  setNameQueryComboboxOpen(details.open);
                }
              }}
            >
              <Combobox.Control onClick={() => setNameQueryComboboxOpen(true)}>
                <Combobox.Input
                  id="nameQuery"
                  placeholder="Type project name or road…"
                />
              </Combobox.Control>
              <Portal>
                <Combobox.Positioner>
                  <Combobox.Content>
                    {projects
                      .filter(p => p.name.toLowerCase().includes(nameQuery.toLowerCase()))
                      .map(p => (
                        <Combobox.Item key={p.name} item={{ label: p.name, value: p.name }}>
                          {p.name}
                        </Combobox.Item>
                      ))}
                  </Combobox.Content>
                </Combobox.Positioner>
              </Portal>
            </Combobox.Root>
          </div>
          <div className="search-item">
            <label htmlFor="tagFilter">Filter by tag</label>
            <Combobox.Root
              collection={createListCollection({
                items: [
                  { label: "All tags", value: "" },
                  ...allTags.map(tag => ({ label: tag, value: tag }))
                ]
              })}
              value={tagFilter ? [tagFilter] : [""]}
              onValueChange={({ value }) => setTagFilter(value[0] ?? "")}
              inputValue={tagFilterInputValue}
              onInputValueChange={(e) => setTagFilterInputValue(e.inputValue)}
              open={tagFilterComboboxOpen}
              onOpenChange={(details) => {
                // Keep dropdown open if there's text in the field
                if (tagFilterInputValue.length > 0) {
                  setTagFilterComboboxOpen(true);
                } else {
                  setTagFilterComboboxOpen(details.open);
                }
              }}
            >
              <Combobox.Control
                onClick={() => setTagFilterComboboxOpen(true)}
              >
                <Combobox.Input
                  id="tagFilter"
                  placeholder="All tags"
                />
                <Combobox.IndicatorGroup>
                  <Combobox.ClearTrigger />
                  <Combobox.Trigger />
                </Combobox.IndicatorGroup>
              </Combobox.Control>
              <Portal>
                <Combobox.Positioner>
                  <Combobox.Content>
                    <Combobox.Item item={{ label: "All tags", value: "" }} key="">
                      All tags
                    </Combobox.Item>
                    {allTags
                      .filter(tag => tag.toLowerCase().includes(tagFilterInputValue.toLowerCase()))
                      .map((tag) => (
                        <Combobox.Item item={{ label: tag, value: tag }} key={tag}>
                          {tag}
                        </Combobox.Item>
                      ))}
                  </Combobox.Content>
                </Combobox.Positioner>
              </Portal>
            </Combobox.Root>
          </div>
          <div className="actions-buttons">
            <Button onClick={loadProject} colorPalette="blue" disabled={selected.size === 0}>
              Load Project
            </Button>
          </div>
        </div>
      </div>

      {/* Project Table */}
      <div className="table-container">
        <div className="table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th style={{ width: 48 }}></th>
                <th>Project Name</th>
                <th style={{ width: 120 }}>Verification Status</th>
                <th>Tags</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingProjects ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Loading projects...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    No projects found
                  </td>
                </tr>
              ) : (
                <>
                  <tr className="select-all-row" onClick={toggleSelectAll} style={{ cursor: "pointer" }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selected.size === filtered.length}
                        onChange={toggleSelectAll}
                        aria-label="Select all projects"
                      />
                    </td>
                    <td colSpan={4}>
                      <strong>Select All</strong>
                    </td>
                  </tr>
                  {filtered.map((p) => {
                    const isSelected = selected.has(p.name);
                    // Get all other tags (excluding Pre/Post)
                    const otherTags = p.tags?.filter(tag => tag !== "Pre" && tag !== "Post") || [];

                    return (
                      <tr
                        key={p.name}
                        className={isSelected ? "row selected" : "row"}
                        onClick={(e) => {
                          // Prevent double-toggle if clicking checkbox directly
                          if ((e.target as HTMLElement).tagName === "INPUT") return;
                          onRowClick(p.name);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onRowClick(p.name)}
                            aria-label={`Select ${p.name}`}
                          />
                        </td>
                        <td title={p.name}>{p.name}</td>
                        <td>
                          <span style={{ fontSize: "16px" }}>
                            {p.verified ? "✅" : "⏳"}
                          </span>
                        </td>
                        <td>
                          <div className="tags-container">
                            {otherTags.length > 0 ? (
                              otherTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="tag-badge"
                                  style={{
                                    backgroundColor: getTagFillColor(tag),
                                    borderColor: getTagBorderColor(tag),
                                    borderWidth: "1px",
                                    borderStyle: "solid",
                                  }}
                                >
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="no-tags">—</span>
                            )}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setEditingProject(p);
                              setOpenEdit(true);
                            }}
                            className="row-edit-btn"
                            aria-label="Edit project"
                          >
                            <LuPencil className="row-edit-icon" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Dialog */}
      {editingProject && (
        <EditProjectModal
          open={openEdit}
          onClose={() => setOpenEdit(false)}
          projectName={editingProject.name}
          projectTags={editingProject.tags}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}
