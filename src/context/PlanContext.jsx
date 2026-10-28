import { createContext, useContext, useMemo } from "react";
import useUserStorage from "../hooks/useUserStorage.js";

const PlanContext = createContext(null);

export function PlanProvider({ children }) {
  const [plan, setPlan] = useUserStorage("gather-v2-plan", null);
  const [favorites, setFavorites] = useUserStorage("gather-v2-favorites", []);
  const [groceryChecks, setGroceryChecks] = useUserStorage("gather-v2-grocery-checks", []);
  const [onlineRecipes, setOnlineRecipes] = useUserStorage("gather-v2-online-recipes", true);

  const value = useMemo(() => ({
    plan,
    setPlan,
    favorites,
    setFavorites,
    groceryChecks,
    setGroceryChecks,
    onlineRecipes,
    setOnlineRecipes,
  }), [plan, setPlan, favorites, setFavorites, groceryChecks, setGroceryChecks, onlineRecipes, setOnlineRecipes]);
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const context = useContext(PlanContext);
  if (!context) throw new Error("usePlan must be used inside PlanProvider.");
  return context;
}
