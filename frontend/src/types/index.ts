/**
 * Shared domain types for the PathSafetyAssessmentTool.
 *
 * This barrel re-exports canonical type definitions so any component can import
 * from "../../types" without knowing which module owns the definition.
 *
 * Canonical sources:
 *  - Project / attribute / filter types → api/projects
 *  - Treatment page–specific types      → pages/TreatmentPage/treatmentConstants (ScoreType, Treatment)
 *  - Coding page–specific types         → pages/CodingPage/codingConstants (ProjectDataState)
 *
 * Add new shared types here only when they are needed by three or more unrelated
 * modules; otherwise keep them co-located with the code that defines them.
 */

export type {
  // Project list
  ProjectListItem,
  FileResponse,

  // Project version detail
  ProjectDetail,

  // Attribute table
  AttributeRow,
  AttributesResponse,
  AttrMappings,
  CalculateScoreResult,

  // Filter context passed from PathAnalysisPage → CodingPage
  FilteredSegmentPoint,
  FilteredProjectData,
  FilterLegendEntry,
  CodingFilterContext,
} from "../api/projects";
