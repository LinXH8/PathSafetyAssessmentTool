/**
 * Barrel re-export for all api/* domain modules.
 *
 * Import from this file to avoid updating every call site during the S1.1
 * refactor. New code should import directly from the relevant domain module
 * (projects, geo, sourceFolders, autocode, treatments, shapefiles, auth,
 * media, reports) for clarity.
 *
 * Domain modules:
 *  - _client.ts      — shared readError helper
 *  - projects.ts     — project/attribute/scoring CRUD + filter-context types
 *  - geo.ts          — road & planning-area geographic queries
 *  - sourceFolders.ts — source folder import/preview
 *  - autocode.ts     — CV + GIS inference endpoints (+ streaming)
 *  - treatments.ts   — treatment apply/preview/reset
 *  - shapefiles.ts   — shapefile upload/replace/validate
 *  - auth.ts         — profile create/login/logout/share
 *  - media.ts        — bulk image download + shapefile export
 *  - reports.ts      — generated report save/list/delete
 */

export * from "./_client";
export * from "./projects";
export * from "./geo";
export * from "./sourceFolders";
export * from "./autocode";
export * from "./treatments";
export * from "./shapefiles";
export * from "./auth";
export * from "./media";
export * from "./reports";
