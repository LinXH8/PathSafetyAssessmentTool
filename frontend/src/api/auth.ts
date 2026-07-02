/**
 * Profile / authentication API — create, log in/out, update, and delete user
 * profiles; migrate legacy projects; share projects between profiles.
 *
 * Used by: LandingPage, ProfileSettingsPage, and the profile-aware context wrapper.
 */

import { readError } from "./_client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProfileSummary {
  id: string;
  name: string;
  username: string;
  slug: string;
  division: string;
  created_at: string;
  last_active_at: string | null;
  project_count: number;
  has_pin: boolean;
  has_email: boolean;
}

export interface ProfilesOverview {
  profiles: ProfileSummary[];
  active_profile: ProfileSummary | null;
  legacy_projects: string[];
}

export interface CreateProfileResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface LoginProfileResult {
  active_profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface LogoutProfileResult {
  ok: boolean;
  overview: ProfilesOverview;
}

export interface UpdateProfileResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface ResetProfilePinResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface RecoverProfilePinResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface RecordProfileActivityResult {
  ok: boolean;
  recorded: boolean;
}

export interface DeleteProfileResult {
  ok: boolean;
  overview: ProfilesOverview;
}

export interface MigrateLegacyProjectsResult {
  moved: string[];
  skipped: Array<{ name: string; reason: string }>;
  missing: string[];
  overview: ProfilesOverview;
}

export interface ShareProjectsResult {
  shared: string[];
  skipped: Array<{ name: string; reason: string }>;
  missing: string[];
  overview: ProfilesOverview;
}

// ── API functions ─────────────────────────────────────────────────────────────

/** GET /api/profiles — list all profiles and the currently active one. */
export async function fetchProfilesOverview(): Promise<ProfilesOverview> {
  const res = await fetch("/api/profiles");
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ProfilesOverview;
}

/**
 * POST /api/profiles — create a new profile.
 * @param username - Display name
 * @param email    - Recovery email (optional)
 * @param pin      - Numeric PIN
 * @param division - Organizational division
 */
export async function createProfile(
  username: string,
  email: string,
  pin: string,
  division: string
): Promise<CreateProfileResult> {
  const res = await fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, pin, division }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as CreateProfileResult;
}

/**
 * POST /api/profiles/login — authenticate with a profile's PIN and make it active.
 * @param profileId - Profile UUID
 * @param pin       - Numeric PIN
 */
export async function loginProfile(profileId: string, pin: string): Promise<LoginProfileResult> {
  const res = await fetch("/api/profiles/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId, pin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as LoginProfileResult;
}

/** POST /api/profiles/logout — deactivate the current profile session. */
export async function logoutProfile(): Promise<LogoutProfileResult> {
  const res = await fetch("/api/profiles/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as LogoutProfileResult;
}

/**
 * PATCH /api/profiles/:id — update profile display fields.
 * Only include `email` when it should change; omitting it leaves the value alone.
 */
export async function updateProfile(
  profileId: string,
  currentPin: string,
  username: string,
  division: string,
  email?: string
): Promise<UpdateProfileResult> {
  const body: Record<string, unknown> = { current_pin: currentPin, username, division };
  if (email !== undefined) body.email = email;
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as UpdateProfileResult;
}

/**
 * POST /api/profiles/:id/reset-pin — change the PIN for a profile.
 * @param currentPin - Existing PIN for verification
 * @param newPin     - New PIN to set
 */
export async function resetProfilePin(
  profileId: string,
  currentPin: string,
  newPin: string
): Promise<ResetProfilePinResult> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/reset-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ResetProfilePinResult;
}

/**
 * POST /api/profiles/:id/recover-pin — reset the PIN using a recovery email.
 * @param email  - Recovery email on file for the profile
 * @param newPin - New PIN to set
 */
export async function recoverProfilePin(
  profileId: string,
  email: string,
  newPin: string
): Promise<RecoverProfilePinResult> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/recover-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, new_pin: newPin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RecoverProfilePinResult;
}

/**
 * POST /api/profiles/activity — log a usage event for the active profile.
 * @param eventType   - Event identifier string
 * @param payload     - Optional structured data for the event
 * @param projectName - Optional project context
 */
export async function recordProfileActivity(
  eventType: string,
  payload?: Record<string, unknown>,
  projectName?: string
): Promise<RecordProfileActivityResult> {
  const res = await fetch("/api/profiles/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, payload, project_name: projectName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RecordProfileActivityResult;
}

/**
 * DELETE /api/profiles/:id — permanently delete a profile.
 * @param pin - Profile PIN for confirmation
 */
export async function deleteProfile(
  profileId: string,
  pin: string
): Promise<DeleteProfileResult> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as DeleteProfileResult;
}

/**
 * POST /api/profiles/migrate-legacy-projects — move legacy (pre-profile) projects
 * into the active profile's project directory.
 * @param projectNames - Subset of legacy projects to migrate; defaults to all
 */
export async function migrateLegacyProjects(
  projectNames?: string[]
): Promise<MigrateLegacyProjectsResult> {
  const res = await fetch("/api/profiles/migrate-legacy-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_names: projectNames }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as MigrateLegacyProjectsResult;
}

/**
 * POST /api/profiles/share-projects — copy projects from the active profile to
 * another profile's project directory.
 * @param targetProfileId - UUID of the destination profile
 * @param projectNames    - Names of projects to share
 */
export async function shareProjects(
  targetProfileId: string,
  projectNames: string[]
): Promise<ShareProjectsResult> {
  const res = await fetch("/api/profiles/share-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_profile_id: targetProfileId, project_names: projectNames }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ShareProjectsResult;
}
