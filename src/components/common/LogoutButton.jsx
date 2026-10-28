import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { ROUTES } from "../../utils/appFlow.js";

export default function LogoutButton() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <button className="theme-toggle logout-button" type="button" onClick={async () => { await logOut(); navigate(ROUTES.login, { replace: true }); }} title={`Signed in as ${user.email}`}>
      <LogOut size={16} />
      <span>Log out</span>
    </button>
  );
}
