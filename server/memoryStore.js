import { randomUUID } from "node:crypto";
import { MAP_RESOURCES, emptyUserData } from "./userData.js";

// Same methods as the Supabase store (server/supabaseStore.js), kept in memory. Used by the tests and by
// AUTH_STORE=memory for running without a database; everything is lost when the server stops.
export function createMemoryStore() {
  const users = new Map();
  const sessions = new Map();
  // userId -> app data, with diary, water and weights held as { "YYYY-MM-DD": value } maps.
  const userData = new Map();

  return {
    ping: async () => {},
    findUserByEmail: async (email) => [...users.values()].find((user) => user.email === email) ?? null,
    findUserById: async (id) => users.get(id) ?? null,
    async insertUser(user) {
      if ([...users.values()].some((existing) => existing.email === user.email)) return null;
      const saved = { ...user, id: randomUUID() };
      users.set(saved.id, saved);
      return saved;
    },
    async deleteUser(id) {
      users.delete(id);
      userData.delete(id);
      for (const [tokenHash, session] of sessions) if (session.userId === id) sessions.delete(tokenHash);
    },
    insertSession: async (session) => sessions.set(session.tokenHash, session),
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      return session && session.expiresAt > new Date() ? session : null;
    },
    deleteSession: async (tokenHash) => sessions.delete(tokenHash),

    async loadUserData(userId) {
      const saved = userData.get(userId);
      const data = structuredClone(saved ?? { ...emptyUserData(), weights: {} });
      data.weights = Object.entries(data.weights).sort(([a], [b]) => a.localeCompare(b)).map(([date, kg]) => ({ date, kg }));
      return { data, empty: !saved };
    },
    async saveUserData(userId, changes) {
      const data = userData.get(userId) ?? { ...emptyUserData(), weights: {} };
      for (const [key, value] of Object.entries(structuredClone(changes))) {
        if (!MAP_RESOURCES.includes(key)) {
          data[key] = value;
          continue;
        }
        for (const [date, dayValue] of Object.entries(value)) {
          if (dayValue === null) delete data[key][date];
          else data[key][date] = dayValue;
        }
      }
      userData.set(userId, data);
    },

    close: async () => {},
  };
}
