import { createContext, useContext, useEffect, useMemo, useState } from "react";
import useLocalStorage from "../hooks/useLocalStorage.js";

// The theme belongs to the device, not to an account, so the login screen uses it too.
const ThemeContext = createContext(null);
const darkQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

// Earlier versions stored a boolean; an explicit "dark" choice is kept, anything else follows the system.
function legacyTheme() {
  try {
    return JSON.parse(window.localStorage.getItem("gather-v2-dark-mode")) === true ? "dark" : "system";
  } catch {
    return "system";
  }
}

function useSystemDark() {
  const [systemDark, setSystemDark] = useState(() => Boolean(darkQuery()?.matches));
  useEffect(() => {
    const query = darkQuery();
    if (!query) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return systemDark;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useLocalStorage("gather-v3-theme", legacyTheme);
  const systemDark = useSystemDark();
  const darkMode = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", darkMode);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", darkMode ? "#171e18" : "#f6f7f2");
  }, [darkMode]);

  const value = useMemo(() => ({ darkMode, setDarkMode: (dark) => setTheme(dark ? "dark" : "light") }), [darkMode, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
