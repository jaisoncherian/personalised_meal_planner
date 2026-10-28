import { Leaf } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../../context/ProfileContext.jsx";
import { ROUTES } from "../../utils/appFlow.js";
import LogoutButton from "../common/LogoutButton.jsx";
import ThemeToggle from "../common/ThemeToggle.jsx";

// Page chrome shared by onboarding, results and meal preferences (screens outside the dashboard layout).
export default function FlowShell({ children }) {
  const { profile, darkMode } = useProfile();
  const navigate = useNavigate();
  return (
    <div className={`wizard-page ${darkMode ? "theme-dark" : ""}`}>
      <header className="wizard-header"><button className="brand wizard-brand" type="button" onClick={() => navigate(profile ? ROUTES.dashboard : ROUTES.onboarding)}><span className="brand-mark"><Leaf size={18} /></span><span>gather<span className="brand-period">.</span><small>MEAL PLANNER</small></span></button><div className="wizard-header-right"><span>YOUR PERSONAL PLAN</span><ThemeToggle /><LogoutButton /></div></header>
      <main className="wizard-main">{children}</main>
    </div>
  );
}

export function FlowFooter() {
  return <footer className="wizard-footer"><span><Leaf size={13} /> Thoughtful food, tailored to you.</span><span>Private by design · Saved on this device</span></footer>;
}
