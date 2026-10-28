import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "./components/common/AppLayout.jsx";
import ProfileNeedsUpdate from "./components/common/ProfileNeedsUpdate.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { PlanProvider } from "./context/PlanContext.jsx";
import { ProfileProvider, useProfile } from "./context/ProfileContext.jsx";
import { DiaryProvider } from "./context/DiaryContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { UserDataProvider } from "./context/UserDataContext.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import FavoritesPage from "./pages/FavoritesPage.jsx";
import GroceryPage from "./pages/GroceryPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import PreferencesPage from "./pages/PreferencesPage.jsx";
import ResultsPage from "./pages/ResultsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import { ROUTES, guardProfileRoute } from "./utils/appFlow.js";

const DiaryPage = lazy(() => import("./pages/DiaryPage.jsx"));
const ReportsPage = lazy(() => import("./pages/ReportsPage.jsx"));

// Everything except the login page needs a signed-in user. The data providers are keyed by user,
// so switching accounts remounts them and loads that person's own profile, plan and diary from the server.
function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="auth-loading" role="status">Loading…</div>;
  if (!user) return <Navigate to={ROUTES.login} replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <UserDataProvider key={user.id}><ProfileProvider><PlanProvider><DiaryProvider><Outlet /></DiaryProvider></PlanProvider></ProfileProvider></UserDataProvider>;
}

// Every screen after onboarding needs a valid saved profile; without one the user is sent to onboarding.
function RequireProfile() {
  const { profile } = useProfile();
  const guard = guardProfileRoute(profile);
  if (guard.redirect) return <Navigate to={guard.redirect} replace />;
  if (guard.needsUpdate) return <ProfileNeedsUpdate errors={guard.needsUpdate} />;
  return <Outlet />;
}

export default function App() {
  return <ThemeProvider><AuthProvider><Routes>
    <Route path={ROUTES.login} element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      <Route path="/" element={<HomePage />} />
      <Route path={ROUTES.onboarding} element={<OnboardingPage />} />
      <Route path="/wizard" element={<Navigate to={ROUTES.onboarding} replace />} />
      <Route element={<RequireProfile />}>
        <Route path={ROUTES.results} element={<ResultsPage />} />
        <Route path={ROUTES.preferences} element={<PreferencesPage />} />
        <Route element={<AppLayout />}>
          <Route path={ROUTES.dashboard} element={<DashboardPage />} />
          <Route path="/grocery" element={<GroceryPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/diary" element={<Suspense fallback={<div className="panel diary-route-loading" role="status">Loading your diary…</div>}><DiaryPage /></Suspense>} />
          <Route path="/reports" element={<Suspense fallback={<div className="panel diary-route-loading" role="status">Loading your reports…</div>}><ReportsPage /></Suspense>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<HomePage />} />
    </Route>
  </Routes></AuthProvider></ThemeProvider>;
}
