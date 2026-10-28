import { CalendarDays, Heart, Leaf, NotebookTabs, Settings, ShoppingBasket, UserRound, ChartNoAxesCombined } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { usePlan } from "../../context/PlanContext.jsx";
import { useProfile } from "../../context/ProfileContext.jsx";
import LogoutButton from "./LogoutButton.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { ROUTES } from "../../utils/appFlow.js";

export default function AppLayout() {
  const { profile, beginWizard, darkMode } = useProfile();
  const { favorites } = usePlan();
  const navigate = useNavigate();
  return (
    <div className={`app-shell ${darkMode ? "theme-dark" : ""}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("/dashboard")} aria-label="Gather dashboard">
          <span className="brand-mark"><Leaf size={19} /></span><span>gather<span className="brand-period">.</span><small>MEAL PLANNER</small></span>
        </button>
        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><CalendarDays size={18} />My week</NavLink>
          <NavLink to="/grocery" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><ShoppingBasket size={18} />Grocery list</NavLink>
          <NavLink to="/diary" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><NotebookTabs size={18} />Food diary</NavLink>
          <NavLink to="/favorites" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Heart size={18} />Favorites{favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}</NavLink>
          <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><ChartNoAxesCombined size={18} />Reports</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Settings size={18} />Settings</NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><span className="tip-spark">✳</span><strong>Small steps,<br />better days.</strong><p>A plan that fits your life is one you can stick with.</p></div>
          <button className="profile-link" onClick={() => { beginWizard(profile); navigate(ROUTES.onboarding); }}>
            <span className="avatar">{profile.name?.slice(0, 1).toUpperCase() || "Y"}</span>
            <span><strong>{profile.name}</strong><small>Edit your profile</small></span><UserRound size={16} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>GATHER</span><span>/</span><strong>YOUR PERSONAL PLAN</strong></div><div className="topbar-tools"><ThemeToggle /><LogoutButton /></div></header>
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  );
}
