import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import LandingPage from "./pages/LandingPage/landingPage";
import Home from "./pages/Projects/projects";
import CodingPage from "./pages/CodingPage/codingPage"
import CreateProjectPage from "./pages/CreateProjectPage/createProjectPage"
import TreatmentPage from "./pages/TreatmentPage/treatmentPage"
import TreatmentDetailPage from "./pages/TreatmentPage/treatmentDetailPage"
import PathAnalysisPage from "./pages/PathAnalysisPage/pathAnalysisPage"
import ReportBuilderPage from "./pages/ReportBuilderPage/reportBuilderPage"
import GisLayersPage from "./pages/GisLayersPage/GisLayersPage"

import AppLayout from "./layouts/AppLayout";
import HelpButton from "./components/common/HelpButton";
import HelpPage from "./pages/HelpPage/helpPage";
import RequireProfile from "./features/profile/RequireProfile";
import { recordProfileActivity } from "./api";
import { useProfile } from "./features/profile/ProfileProvider";

function NavigationTelemetry() {
  const location = useLocation();
  const { activeProfile } = useProfile();

  useEffect(() => {
    if (!activeProfile) {
      return;
    }

    const page = location.pathname;
    const dedupeKey = `${activeProfile.id}:${page}`;
    const now = Date.now();
    const lastPageView = (window as any).__psatLastPageView;
    if (lastPageView && lastPageView.key === dedupeKey && now - lastPageView.at < 1000) {
      return;
    }

    (window as any).__psatLastPageView = { key: dedupeKey, at: now };
    void recordProfileActivity("page_view", { page }).catch(() => {});
  }, [activeProfile, location.pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <HelpButton />
      <NavigationTelemetry />
      <Routes>

        <Route path="/" element={<LandingPage />} />
        <Route path="/help" element={<HelpPage />} />

        <Route element={<RequireProfile><AppLayout /></RequireProfile>}>
          <Route path="/home" element={<Home />} />
          <Route path="/coding/:projectNames" element={<CodingPage />} />
          <Route path="/treatment" element={<TreatmentPage />} />
          <Route path="/treatment/:projectName" element={<TreatmentDetailPage />} />
          <Route path="/analysis/path" element={<PathAnalysisPage />} />
          <Route path="/analysis/report" element={<ReportBuilderPage />} />
          <Route path="/projects/create" element={<CreateProjectPage />} />
          <Route path="/gis-layers" element={<GisLayersPage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </>
  );
}
