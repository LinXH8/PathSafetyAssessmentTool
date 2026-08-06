/**
 * Broadcasts that the current profile's project list has changed (created,
 * deleted, imported). AppLayout mounts the sidebar once and keeps it mounted
 * across in-app navigation, so components that fetch the project list on
 * mount (e.g. SidebarV2) need an explicit signal to refetch — otherwise a
 * newly created/deleted/imported project is invisible until a full reload.
 */

const EVENT = "psat:projectList:updated";

export function notifyProjectListChanged() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onProjectListChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
