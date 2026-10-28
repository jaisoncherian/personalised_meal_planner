import { useCallback, useState } from "react";
import { useUserData } from "../context/UserDataContext.jsx";
import { STORAGE_KEY_RESOURCES } from "../utils/userData.js";

// One value of the signed-in account's data, saved on the server. Same [value, setValue] shape as useLocalStorage,
// including functional updates; the key names the field it used to have in localStorage.
export default function useUserStorage(key, initialValue) {
  const { values, setValue } = useUserData();
  const resource = STORAGE_KEY_RESOURCES[key];
  if (!resource) throw new Error(`"${key}" is not saved on the server; add it to STORAGE_KEY_RESOURCES.`);
  const [fallback] = useState(() => (typeof initialValue === "function" ? initialValue() : initialValue));
  const set = useCallback((next) => setValue(resource, next, fallback), [setValue, resource, fallback]);
  return [values[resource] ?? fallback, set];
}
