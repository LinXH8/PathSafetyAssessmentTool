import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUiVersion } from "../../features/ui/useUiVersion";
import type { HelpPageViewModel, HelpTab } from "./layouts/HelpPageViewModel";
import HelpPageLayoutV1 from "./layouts/HelpPageLayoutV1";
import HelpPageLayoutV2 from "./layouts/HelpPageLayoutV2";

export default function HelpPage() {
  const navigate = useNavigate();
  const ui = useUiVersion();
  const [activeTab, setActiveTab] = useState<HelpTab>("user");

  const vm: HelpPageViewModel = {
    activeTab,
    setActiveTab,
    onBack: () => navigate(-1),
  };

  return ui === "v2"
    ? <HelpPageLayoutV2 {...vm} />
    : <HelpPageLayoutV1 {...vm} />;
}
