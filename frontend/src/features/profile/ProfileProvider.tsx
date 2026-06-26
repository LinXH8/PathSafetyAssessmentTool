import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
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

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

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
    createProfile,
    login,
    logout,
    updateProfile,
    resetProfilePin,
    recoverProfilePin,
    deleteProfile,
    migrateLegacyProjects,
  }), [overview, loading, error, refreshOverview, createProfile, login, logout, updateProfile, resetProfilePin, recoverProfilePin, deleteProfile, migrateLegacyProjects]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}