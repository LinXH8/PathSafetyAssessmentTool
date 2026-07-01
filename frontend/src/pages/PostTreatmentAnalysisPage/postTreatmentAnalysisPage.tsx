import { useState, useEffect, useMemo } from "react";
import {
  Box,
  Flex,
  Text,
  Button,
} from "@chakra-ui/react";
import { fetchProjectList, type FileResponse } from "../../api";
import { matchesProjectSearch } from "../../utils/projectSearch";
import { getTagFillColor, getTagBorderColor } from "../Projects/tagColor";
import "../Projects/projects.css"; // Reuse projects page styles

export default function PostTreatmentAnalysisPage() {
  // Project list state
  const [projectList, setProjectList] = useState<FileResponse | null>(null);

  // Filter and selection states
  const [nameQuery, setNameQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  // Fetch projects on mount - filter for "Post" tag
  useEffect(() => {
    fetchProjectList()
      .then((data) => setProjectList(data))
      .catch(() => {});
  }, []);

  // Process projects - filter for those with "Post" tag
  const projects = useMemo(() => {
    if (!projectList?.projects) return [];
    return projectList.projects
      .filter((p) => p.tags && p.tags.includes("Post"))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectList]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = projects;
    if (nameQuery.trim()) list = list.filter((project) => matchesProjectSearch(project, nameQuery));
    return list;
  }, [projects, nameQuery]);

  const onRowClick = (name: string) => setSelected(name);

  const analyzeProject = async () => {
    if (!selected) return;
    // TODO: Navigate to analysis view or show analysis dashboard
  };

  const compareProjects = async () => {
    if (!selected) return;
    // TODO: Open comparison view
  };

  return (
    <Box className="home-root">
      {/* Header */}
      <Box mb="6">
        <Text fontSize="2xl" fontWeight="bold" mb="2">
          Post-Treatment Analysis
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Analyze projects after treatment implementation
        </Text>
      </Box>

      {/* Info banner */}
      <Box
        p="4"
        mb="4"
        borderRadius="lg"
        bg="green.subtle"
        borderWidth="1px"
        borderColor="green.emphasized"
      >
        <Flex align="center" gap="2">
          <Text fontWeight="semibold" fontSize="sm">
            ✅ Post-Treatment Projects
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Viewing projects after treatment implementation
          </Text>
        </Flex>
      </Box>

      {/* Search Panel */}
      <div className="search-panel">
        <div className="search-row">
          <div className="search-item">
            <label htmlFor="nameQuery">Search by project or road</label>
            <input
              id="nameQuery"
              type="text"
              placeholder="Type project name or road…"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Project Table */}
      <div className="table-wrap">
        <table className="project-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}></th>
              <th>Project Name</th>
              <th>Tags</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  No post-treatment projects found. Create a new project with "Post" tag to see it here.
                </td>
              </tr>
            ) : (
              filtered.map((project) => {
                const isSelected = selected === project.name;
                // Get all tags excluding Pre/Post
                const otherTags = project.tags?.filter(tag => tag !== "Pre" && tag !== "Post") || [];
                return (
                  <tr
                    key={project.name}
                    className={isSelected ? "row selected" : "row"}
                    onClick={() => onRowClick(project.name)}
                  >
                    <td>
                      <input
                        type="radio"
                        name="projectSelect"
                        checked={isSelected}
                        onChange={() => onRowClick(project.name)}
                        aria-label={`Select ${project.name}`}
                      />
                    </td>
                    <td title={project.name}>{project.name}</td>
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
                    <td>
                      <Box
                        as="span"
                        px="2"
                        py="1"
                        borderRadius="md"
                        fontSize="xs"
                        fontWeight="semibold"
                        bg="green.subtle"
                        color="green.fg"
                      >
                        Post
                      </Box>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Action Buttons */}
      <div className="actions-panel">
        <div className="buttons">
          <Button
            onClick={analyzeProject}
            colorPalette="blue"
            disabled={!selected}
          >
            Analyze Project
          </Button>
          <Button
            onClick={compareProjects}
            colorPalette="purple"
            disabled={!selected}
          >
            Compare Pre/Post
          </Button>
        </div>
      </div>
    </Box>
  );
}
