import { createContext, useContext, useMemo } from "react";
import useUserStorage from "../hooks/useUserStorage.js";

const DiaryContext = createContext(null);

export function DiaryProvider({ children }) {
  const [diary, setDiary] = useUserStorage("gather-v2-diary", {});
  const [customFoods, setCustomFoods] = useUserStorage("gather-v2-custom-foods", []);
  const [savedMeals, setSavedMeals] = useUserStorage("gather-v2-saved-meals", []);
  const [recentFoods, setRecentFoods] = useUserStorage("gather-v2-recent-foods", []);
  const [water, setWater] = useUserStorage("gather-v2-water", {});
  const [waterGoal, setWaterGoal] = useUserStorage("gather-v2-water-goal", 8);
  const [weights, setWeights] = useUserStorage("gather-v2-weights", []);

  const value = useMemo(() => ({
    diary, setDiary, customFoods, setCustomFoods, savedMeals, setSavedMeals,
    recentFoods, setRecentFoods, water, setWater, waterGoal, setWaterGoal, weights, setWeights,
  }), [diary, setDiary, customFoods, setCustomFoods, savedMeals, setSavedMeals,
    recentFoods, setRecentFoods, water, setWater, waterGoal, setWaterGoal, weights, setWeights]);

  return <DiaryContext.Provider value={value}>{children}</DiaryContext.Provider>;
}

export function useDiary() {
  const context = useContext(DiaryContext);
  if (!context) throw new Error("useDiary must be used inside DiaryProvider.");
  return context;
}
