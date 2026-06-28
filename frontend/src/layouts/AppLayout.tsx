import { Outlet } from "react-router-dom";
import Sidebar from "../pages/sidebar/Sidebar";
import { useUiVersion } from "../features/ui/useUiVersion";
import "./app-layout.css";

export default function AppLayout() {
  const ui = useUiVersion();
  const isV2 = ui === "v2";
  return (
    <div className={isV2 ? "app-shell app-shell--v2" : "app-shell"}>
      <Sidebar />
      <main className={isV2 ? "app-main app-main--v2" : "app-main"} role="main">
        <Outlet />
      </main>
    </div>
  );
}
