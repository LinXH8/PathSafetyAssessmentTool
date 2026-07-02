export type HelpTab = "user" | "admin" | "developer";

export interface HelpPageViewModel {
  activeTab: HelpTab;
  setActiveTab: (tab: HelpTab) => void;
  onBack: () => void;
}
