import { must } from "./supabase.js";
import { DIARY_SLOTS, emptyUserData } from "./userData.js";

// Accounts, sessions and per-account app data in Supabase (schema: supabase/schema.sql). Rows are snake_case;
// this file maps them to and from the camelCase shapes the routes and the React app already use.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_COLUMNS = "id, name, email, salt, hash, created_at";
const DIARY_COLUMNS = "entry_date, slot, position, client_id, name, servings, calories, protein, carbs, fat, source, logged_at";
const FOOD_COLUMNS = "client_id, name, calories, protein, carbs, fat, ingredients, diet_type, source";
const UNIQUE_VIOLATION = "23505";
// Supabase caps each response (1,000 rows by default), so long histories are read page by page.
const PAGE_SIZE = 1000;
// Diary days are replaced one RPC call per day; an import of a long history is sent a few days at a time.
const DIARY_DAYS_AT_ONCE = 8;

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
const toUser = (row) => row && {
  id: row.id, name: row.name, email: row.email, salt: row.salt, hash: row.hash, createdAt: new Date(row.created_at),
};

function profileToRow(userId, profile) {
  const blankToNull = (value) => (value === "" ? null : value);
  return {
    user_id: userId,
    name: profile.name,
    age: blankToNull(profile.age),
    gender: blankToNull(profile.gender),
    formula_sex: profile.formulaSex,
    height_cm: blankToNull(profile.heightCm),
    weight_kg: blankToNull(profile.weightKg),
    body_fat_percent: profile.bodyFatPercent,
    bmr_formula: profile.bmrFormula,
    units: profile.units,
    activity_level: blankToNull(profile.activityLevel),
    goal: profile.goal,
    target_weight_kg: profile.targetWeightKg,
    pace: profile.pace,
    diet_type: profile.dietType,
    cuisine_preferences: profile.cuisinePreferences,
    meals_per_day: profile.mealsPerDay,
    max_cooking_time: profile.maxCookingTime,
    allergies: profile.allergies,
    disliked_foods: profile.dislikedFoods,
    health_conditions: profile.healthConditions,
    preferences_set: profile.preferencesSet,
  };
}

function rowToProfile(row) {
  return {
    name: row.name,
    age: row.age ?? "",
    gender: row.gender ?? "",
    formulaSex: row.formula_sex ?? "",
    heightCm: toNumber(row.height_cm) ?? "",
    weightKg: toNumber(row.weight_kg) ?? "",
    bodyFatPercent: toNumber(row.body_fat_percent),
    bmrFormula: row.bmr_formula,
    units: row.units,
    activityLevel: row.activity_level ?? "",
    goal: row.goal,
    targetWeightKg: toNumber(row.target_weight_kg),
    pace: row.pace,
    dietType: row.diet_type,
    cuisinePreferences: row.cuisine_preferences ?? [],
    mealsPerDay: row.meals_per_day,
    maxCookingTime: row.max_cooking_time,
    allergies: row.allergies ?? [],
    allergyInput: "",
    dislikedFoods: row.disliked_foods ?? [],
    dislikeInput: "",
    healthConditions: row.health_conditions ?? [],
    preferencesSet: row.preferences_set,
  };
}

const rowToDiaryEntry = (row) => ({
  id: row.client_id,
  name: row.name,
  servings: Number(row.servings),
  calories: Number(row.calories),
  protein: Number(row.protein),
  carbs: Number(row.carbs),
  fat: Number(row.fat),
  source: row.source,
  loggedAt: new Date(row.logged_at).toISOString(),
});

const diaryDayToRows = (day) => (day ? DIARY_SLOTS.flatMap((slot) => day[slot].map((entry, position) => ({
  slot, position, client_id: entry.id, name: entry.name, servings: entry.servings, calories: entry.calories,
  protein: entry.protein, carbs: entry.carbs, fat: entry.fat, source: entry.source, logged_at: entry.loggedAt,
}))) : []);

const rowToFood = (row) => ({
  id: row.client_id,
  name: row.name,
  ...(row.serving_size !== undefined ? { servingSize: row.serving_size } : {}),
  calories: Number(row.calories),
  protein: Number(row.protein),
  carbs: Number(row.carbs),
  fat: Number(row.fat),
  ingredients: row.ingredients ?? [],
  dietType: row.diet_type ?? [],
  source: row.source,
});

const foodToRow = (food, position) => ({
  client_id: food.id,
  position,
  name: food.name,
  ...(food.servingSize !== undefined ? { serving_size: food.servingSize } : {}),
  calories: food.calories,
  protein: food.protein,
  carbs: food.carbs,
  fat: food.fat,
  ingredients: food.ingredients,
  diet_type: food.dietType,
  source: food.source,
});

async function inGroups(items, size, fn) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(fn));
}

export function createSupabaseStore(supabase) {
  // Reads every row of a query; build() must return a fresh query with a stable order.
  async function selectAll(build, action) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = must(await build().range(from, from + PAGE_SIZE - 1), action);
      if (!page.length) return rows;
      rows.push(...page);
    }
  }

  const rpc = async (name, args) => must(await supabase.rpc(name, args), name);

  async function saveDayMap(table, column, userId, days, action) {
    const entries = Object.entries(days);
    const upserts = entries.filter(([, value]) => value !== null).map(([date, value]) => ({ user_id: userId, log_date: date, [column]: value }));
    const removals = entries.filter(([, value]) => value === null).map(([date]) => date);
    if (upserts.length) must(await supabase.from(table).upsert(upserts, { onConflict: "user_id,log_date" }), `${action} save`);
    if (removals.length) must(await supabase.from(table).delete().eq("user_id", userId).in("log_date", removals), `${action} delete`);
  }

  return {
    // Fails with a clear error when the URL, the key or the tables are wrong.
    async ping() {
      must(await supabase.from("users").select("id").limit(1), "connection check");
    },

    async findUserByEmail(email) {
      return toUser(must(await supabase.from("users").select(USER_COLUMNS).eq("email", email).maybeSingle(), "user lookup"));
    },
    async findUserById(id) {
      if (!UUID.test(String(id))) return null;
      return toUser(must(await supabase.from("users").select(USER_COLUMNS).eq("id", id).maybeSingle(), "user lookup"));
    },
    // Returns null when the email is already registered (unique constraint).
    async insertUser(user) {
      const { data, error } = await supabase.from("users")
        .insert({ name: user.name, email: user.email, salt: user.salt, hash: user.hash, created_at: user.createdAt.toISOString() })
        .select(USER_COLUMNS).single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      return toUser(must({ data, error }, "sign-up"));
    },
    async deleteUser(id) {
      must(await supabase.from("users").delete().eq("id", id), "user delete");
    },
    async insertSession(session) {
      must(await supabase.from("sessions").insert({
        token_hash: session.tokenHash, user_id: session.userId,
        created_at: session.createdAt.toISOString(), expires_at: session.expiresAt.toISOString(),
      }), "session create");
    },
    async findSession(tokenHash) {
      const row = must(await supabase.from("sessions").select("token_hash, user_id, created_at, expires_at")
        .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle(), "session lookup");
      return row && { tokenHash: row.token_hash, userId: row.user_id, createdAt: new Date(row.created_at), expiresAt: new Date(row.expires_at) };
    },
    async deleteSession(tokenHash) {
      must(await supabase.from("sessions").delete().eq("token_hash", tokenHash), "session delete");
    },

    async loadUserData(userId) {
      const byUser = (table, columns) => supabase.from(table).select(columns).eq("user_id", userId);
      const [profile, settings, plan, favorites, groceryChecks, diary, customFoods, savedMeals, recentFoods, water, weights] = await Promise.all([
        byUser("profiles", "*").maybeSingle().then((result) => must(result, "profile load")),
        byUser("user_settings", "online_recipes, water_goal, onboarding_step, wizard_draft").maybeSingle().then((result) => must(result, "settings load")),
        byUser("meal_plans", "plan").maybeSingle().then((result) => must(result, "plan load")),
        selectAll(() => byUser("favorite_recipes", "recipe_id").order("position"), "favorites load"),
        selectAll(() => byUser("grocery_checks", "item_key").order("position"), "grocery load"),
        selectAll(() => byUser("diary_entries", DIARY_COLUMNS).order("entry_date").order("slot").order("position").order("id"), "diary load"),
        selectAll(() => byUser("custom_foods", `${FOOD_COLUMNS}, serving_size`).order("position"), "custom foods load"),
        selectAll(() => byUser("saved_meals", FOOD_COLUMNS).order("position"), "saved meals load"),
        selectAll(() => byUser("recent_foods", "food").order("position"), "recent foods load"),
        selectAll(() => byUser("water_logs", "log_date, glasses").order("log_date"), "water load"),
        selectAll(() => byUser("weight_logs", "log_date, weight_kg").order("log_date"), "weights load"),
      ]);

      const data = emptyUserData();
      if (profile) data.profile = rowToProfile(profile);
      if (settings) {
        data.draft = settings.wizard_draft;
        data.step = settings.onboarding_step;
        data.onlineRecipes = settings.online_recipes;
        data.waterGoal = settings.water_goal;
      }
      if (plan) data.plan = plan.plan;
      data.favorites = favorites.map((row) => row.recipe_id);
      data.groceryChecks = groceryChecks.map((row) => row.item_key);
      for (const row of diary) {
        data.diary[row.entry_date] ??= Object.fromEntries(DIARY_SLOTS.map((slot) => [slot, []]));
        data.diary[row.entry_date][row.slot].push(rowToDiaryEntry(row));
      }
      data.customFoods = customFoods.map(rowToFood);
      data.savedMeals = savedMeals.map(rowToFood);
      data.recentFoods = recentFoods.map((row) => row.food);
      data.water = Object.fromEntries(water.map((row) => [row.log_date, row.glasses]));
      data.weights = weights.map((row) => ({ date: row.log_date, kg: Number(row.weight_kg) }));

      const empty = !profile && !settings && !plan && [favorites, groceryChecks, diary, customFoods, savedMeals, recentFoods, water, weights].every((rows) => !rows.length);
      return { data, empty };
    },

    // changes come from sanitizeChanges(), so every value already fits the table constraints.
    async saveUserData(userId, changes) {
      const tasks = [];
      const has = (key) => Object.hasOwn(changes, key);

      const settings = {};
      if (has("draft")) settings.wizard_draft = changes.draft;
      if (has("step")) settings.onboarding_step = changes.step;
      if (has("onlineRecipes")) settings.online_recipes = changes.onlineRecipes;
      if (has("waterGoal")) settings.water_goal = changes.waterGoal;
      if (Object.keys(settings).length) {
        tasks.push(supabase.from("user_settings").upsert({ user_id: userId, ...settings }, { onConflict: "user_id" })
          .then((result) => must(result, "settings save")));
      }

      if (has("profile")) {
        tasks.push((changes.profile
          ? supabase.from("profiles").upsert(profileToRow(userId, changes.profile), { onConflict: "user_id" })
          : supabase.from("profiles").delete().eq("user_id", userId)).then((result) => must(result, "profile save")));
      }
      if (has("plan")) {
        tasks.push((changes.plan
          ? supabase.from("meal_plans").upsert({ user_id: userId, plan: changes.plan }, { onConflict: "user_id" })
          : supabase.from("meal_plans").delete().eq("user_id", userId)).then((result) => must(result, "plan save")));
      }

      if (has("favorites")) tasks.push(rpc("replace_favorite_recipes", { p_user_id: userId, p_recipe_ids: changes.favorites }));
      if (has("groceryChecks")) tasks.push(rpc("replace_grocery_checks", { p_user_id: userId, p_item_keys: changes.groceryChecks }));
      if (has("customFoods")) tasks.push(rpc("replace_custom_foods", { p_user_id: userId, p_foods: changes.customFoods.map(foodToRow) }));
      if (has("savedMeals")) tasks.push(rpc("replace_saved_meals", { p_user_id: userId, p_meals: changes.savedMeals.map(foodToRow) }));
      if (has("recentFoods")) tasks.push(rpc("replace_recent_foods", { p_user_id: userId, p_foods: changes.recentFoods }));

      if (has("diary")) {
        tasks.push(inGroups(Object.entries(changes.diary), DIARY_DAYS_AT_ONCE, ([date, day]) =>
          rpc("replace_diary_day", { p_user_id: userId, p_date: date, p_entries: diaryDayToRows(day) })));
      }
      if (has("water")) tasks.push(saveDayMap("water_logs", "glasses", userId, changes.water, "water"));
      if (has("weights")) tasks.push(saveDayMap("weight_logs", "weight_kg", userId, changes.weights, "weight"));

      // Every write is a replace, upsert or delete, so retrying a partly failed save is safe.
      const results = await Promise.allSettled(tasks);
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },

    close: async () => {},
  };
}
