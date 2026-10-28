import { createContext, useContext, useMemo } from "react";
import useUserStorage from "../hooks/useUserStorage.js";
import { useTheme } from "./ThemeContext.jsx";
import { normalizeProfile } from "../utils/calorieCalculator.js";
import { hasMealPreferences } from "../utils/appFlow.js";

export const createEmptyDraft = () => ({
  name: "",
  age: "",
  gender: "",
  formulaSex: "",
  heightCm: "",
  weightKg: "",
  bodyFatPercent: "",
  bmrFormula: "mifflin",
  units: "metric",
  activityLevel: "",
  goal: "maintain",
  targetWeightKg: "",
  pace: "standard",
  dietType: "vegetarian",
  cuisinePreferences: ["No preference"],
  mealsPerDay: 4,
  maxCookingTime: 30,
  allergies: [],
  allergyInput: "",
  dislikedFoods: [],
  dislikeInput: "",
  healthConditions: [],
  // Food preferences are collected after onboarding, on the meal preferences screen.
  preferencesSet: false,
});

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const [profile, setProfile] = useUserStorage("gather-v2-profile", null);
  const [draft, setDraft] = useUserStorage("gather-v3-wizard-draft", createEmptyDraft());
  // Onboarding became four calculator steps in v5, so older saved step numbers are not reused.
  const [step, setStep] = useUserStorage("gather-v5-onboarding-step", 0);
  const { darkMode, setDarkMode } = useTheme();

  const value = useMemo(() => ({
    profile,
    setProfile,
    draft,
    setDraft,
    step,
    setStep,
    darkMode,
    setDarkMode,
    beginWizard(existingProfile = null) {
      if (existingProfile) {
        setDraft({ ...createEmptyDraft(), ...normalizeProfile(existingProfile), preferencesSet: hasMealPreferences(existingProfile) });
        setStep(0);
      }
    },
    resetWizard() {
      setDraft(createEmptyDraft());
      setStep(0);
    },
  }), [profile, setProfile, draft, setDraft, step, setStep, darkMode, setDarkMode]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) throw new Error("useProfile must be used inside ProfileProvider.");
  return context;
}
