import { calculateNutrition, normalizeProfile, roundTo, validateProfile } from "./calorieCalculator.js";
import { CALORIE_ROUNDING } from "./nutritionConstants.js";

// The app's screens in the order a new user meets them.
export const ROUTES = Object.freeze({
  login: "/login",
  onboarding: "/onboarding",
  results: "/results",
  dashboard: "/dashboard",
  preferences: "/preferences",
});

export function profileErrors(profile) {
  if (!profile) return { profile: "No profile saved yet." };
  return validateProfile(normalizeProfile(profile));
}

// Where the app opens: new users onboard first, returning users go straight to the dashboard.
export function entryRoute(profile) {
  return profile ? ROUTES.dashboard : ROUTES.onboarding;
}

// Decides what a profile-only screen (dashboard, results, diary…) may render.
// { redirect } → send the user there; { needsUpdate } → saved profile fails validation; { allow } → render.
export function guardProfileRoute(profile) {
  if (!profile) return { redirect: ROUTES.onboarding };
  const errors = profileErrors(profile);
  if (Object.keys(errors).length) return { needsUpdate: errors };
  return { allow: true };
}

// Profiles created before food preferences moved out of onboarding already had them set.
export function hasMealPreferences(profile) {
  return Boolean(profile) && profile.preferencesSet !== false;
}

// True when a saved plan was built for a different calorie goal than the current one.
export function planIsOutdated(plan, nutrition) {
  return Boolean(plan?.targetCalories) && plan.targetCalories !== nutrition.calories;
}

// The numbers behind the dashboard's "today" card.
export function dailyProgress(profile, eatenCalories = 0) {
  const nutrition = calculateNutrition(profile);
  const goal = nutrition.calories;
  const eaten = Math.max(0, Math.round(Number(eatenCalories) || 0));
  return {
    nutrition,
    goal,
    eaten,
    remaining: goal - eaten,
    over: eaten > goal,
    percent: goal > 0 ? Math.min(100, Math.round((eaten / goal) * 100)) : 0,
  };
}

// One- or two-line explanation of where the goal comes from.
export function goalExplanation(nutrition, { goal, pace }, paceLabel = "") {
  // Same rounding as the results chart, so the sentence and the chart agree.
  const maintenance = roundTo(nutrition.tdee, CALORIE_ROUNDING).toLocaleString("en-US");
  const target = nutrition.calories.toLocaleString("en-US");
  if (goal === "maintain") {
    return `Your maintenance is about ${maintenance} kcal a day, so eating ${target} kcal should keep your weight steady.`;
  }
  const verb = goal === "lose" ? "lose" : "gain";
  let sentence = `Your maintenance is about ${maintenance} kcal. To ${verb} ${paceLabel || (pace === "mild" ? "~0.25 kg/week" : "~0.5 kg/week")}, your goal is ${target} kcal.`;
  if (nutrition.deficitCapApplied) sentence += " The deficit was limited to 25% of your maintenance so it stays sustainable.";
  if (nutrition.safetyFloorApplied) sentence += ` It was raised to the ${nutrition.safetyFloor.toLocaleString("en-US")} kcal minimum — please check with a doctor or dietitian before eating less.`;
  return sentence;
}
