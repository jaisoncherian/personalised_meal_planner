import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../context/ThemeContext.jsx";

export default function ThemeToggle() {
  const { darkMode, setDarkMode } = useTheme();
  return (
    <button className="theme-toggle" type="button" onClick={() => setDarkMode(!darkMode)} aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}>
      {darkMode ? <Sun size={16} /> : <Moon size={16} />}
      <span>{darkMode ? "Light" : "Dark"} mode</span>
    </button>
  );
}
