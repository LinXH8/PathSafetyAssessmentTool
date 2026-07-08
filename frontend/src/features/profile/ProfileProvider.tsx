import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  checkBackendHealth,
  createProfile as apiCreateProfile,
  deleteProfile as apiDeleteProfile,
  fetchProfilesOverview,
  loginProfile as apiLoginProfile,
  logoutProfile as apiLogoutProfile,
  migrateLegacyProjects as apiMigrateLegacyProjects,
  recoverProfilePin as apiRecoverProfilePin,
  resetProfilePin as apiResetProfilePin,
  updateProfile as apiUpdateProfile,
  type CreateProfileResult,
  type DeleteProfileResult,
  type LoginProfileResult,
  type MigrateLegacyProjectsResult,
  type ProfileSummary,
  type ProfilesOverview,
  type RecoverProfilePinResult,
  type ResetProfilePinResult,
  type UpdateProfileResult,
} from "../../api";

type ProfileContextValue = {
  profiles: ProfileSummary[];
  activeProfile: ProfileSummary | null;
  legacyProjects: string[];
  loading: boolean;
  error: string | null;
  refreshOverview: () => Promise<ProfilesOverview | null>;
  /** Re-run the initial load (with startup retry). Used by the "Try again" affordance. */
  retry: () => Promise<void>;
  createProfile: (username: string, email: string, pin: string, division: string) => Promise<CreateProfileResult>;
  login: (profileId: string, pin: string) => Promise<LoginProfileResult>;
  logout: () => Promise<void>;
  updateProfile: (profileId: string, currentPin: string, username: string, division: string, email?: string) => Promise<UpdateProfileResult>;
  resetProfilePin: (profileId: string, currentPin: string, newPin: string) => Promise<ResetProfilePinResult>;
  recoverProfilePin: (profileId: string, email: string, newPin: string) => Promise<RecoverProfilePinResult>;
  deleteProfile: (profileId: string, pin: string) => Promise<DeleteProfileResult>;
  migrateLegacyProjects: (projectNames?: string[]) => Promise<MigrateLegacyProjectsResult>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

function normalizeOverview(overview: ProfilesOverview | null | undefined): ProfilesOverview {
  return {
    profiles: overview?.profiles ?? [],
    active_profile: overview?.active_profile ?? null,
    legacy_projects: overview?.legacy_projects ?? [],
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<ProfilesOverview>(normalizeOverview(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyOverview = useCallback((nextOverview: ProfilesOverview | null | undefined) => {
    setOverview(normalizeOverview(nextOverview));
  }, []);

  const refreshOverview = useCallback(async () => {
    try {
      const nextOverview = await fetchProfilesOverview();
      applyOverview(nextOverview);
      setError(null);
      return normalizeOverview(nextOverview);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to load profiles.";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyOverview]);

  // Guards against a load loop resolving after the provider unmounts (or after a
  // newer load has superseded it, e.g. React StrictMode double-invoking effects).
  const loadTokenRef = useRef(0);

  /**
   * Initial profile load, resilient to a cold backend.
   *
   * On startup the browser (Vite dev server / static bundle) is ready well before
   * Flask finishes its heavy imports and starts listening on :8000, so the first
   * `GET /api/profiles` used to fail at the proxy (ECONNREFUSED) and leave the page
   * stuck in an error state until the user manually refreshed.
   *
   * Instead we run two phases:
   *   1. Poll the cheap, side-effect-free `/api/ping` readiness probe with capped
   *      exponential backoff (keeping the spinner up) until the backend is online.
   *   2. Fetch the profiles overview exactly once. A failure here means the server
   *      is up but genuinely errored (e.g. unreadable registry), so we surface it
   *      immediately rather than retrying a doomed request.
   */
  const loadProfiles = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const isCurrent = () => loadTokenRef.current === token;

    setLoading(true);
    setError(null);

    // Phase 1 — wait for readiness. ~34s window (300ms → 2s cap) is long enough
    // for a cold backend (torch/geopandas imports) to come online.
    const maxAttempts = 20;
    let ready = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (await checkBackendHealth()) {
        ready = true;
        break;
      }
      if (!isCurrent()) return;
      const delay = Math.min(2000, 300 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!isCurrent()) return;
    }

    if (!ready) {
      setError("Backend is not responding. Please try again.");
      setLoading(false);
      return;
    }

    // Phase 2 — backend is up; load the overview once.
    try {
      const nextOverview = await fetchProfilesOverview();
      if (!isCurrent()) return;
      applyOverview(nextOverview);
      setError(null);
    } catch (nextError) {
      if (!isCurrent()) return;
      const message = nextError instanceof Error ? nextError.message : "Failed to load profiles.";
      setError(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [applyOverview]);

  useEffect(() => {
    void loadProfiles();
    return () => {
      // Supersede any in-flight retry loop so it stops touching state.
      loadTokenRef.current += 1;
    };
  }, [loadProfiles]);

  const createProfile = useCallback(async (username: string, email: string, pin: string, division: string) => {
    const result = await apiCreateProfile(username, email, pin, division);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const login = useCallback(async (profileId: string, pin: string) => {
    const result = await apiLoginProfile(profileId, pin);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const logout = useCallback(async () => {
    const result = await apiLogoutProfile();
    applyOverview(result.overview);
    setError(null);
  }, [applyOverview]);

  const updateProfile = useCallback(async (profileId: string, currentPin: string, username: string, division: string, email?: string) => {
    const result = await apiUpdateProfile(profileId, currentPin, username, division, email);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const resetProfilePin = useCallback(async (profileId: string, currentPin: string, newPin: string) => {
    const result = await apiResetProfilePin(profileId, currentPin, newPin);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const recoverProfilePin = useCallback(async (profileId: string, email: string, newPin: string) => {
    const result = await apiRecoverProfilePin(profileId, email, newPin);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const deleteProfile = useCallback(async (profileId: string, pin: string) => {
    const result = await apiDeleteProfile(profileId, pin);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const migrateLegacyProjects = useCallback(async (projectNames?: string[]) => {
    const result = await apiMigrateLegacyProjects(projectNames);
    applyOverview(result.overview);
    setError(null);
    return result;
  }, [applyOverview]);

  const value = useMemo<ProfileContextValue>(() => ({
    profiles: overview.profiles,
    activeProfile: overview.active_profile,
    legacyProjects: overview.legacy_projects,
    loading,
    error,
    refreshOverview,
    retry: loadProfiles,
    createProfile,
    login,
    logout,
    updateProfile,
    resetProfilePin,
    recoverProfilePin,
    deleteProfile,
    migrateLegacyProjects,
  }), [overview, loading, error, refreshOverview, loadProfiles, createProfile, login, logout, updateProfile, resetProfilePin, recoverProfilePin, deleteProfile, migrateLegacyProjects]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}