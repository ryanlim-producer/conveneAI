import { getDb } from "./db";

export interface UserSettings {
  deepgramModel: string;
  actionsLlmModel: string;
  chatbotLlmModel: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  deepgramModel: "nova-3",
  actionsLlmModel: "deepseek/deepseek-r1",
  chatbotLlmModel: "deepseek/deepseek-r1",
};

export function getUserSettings(userId: string): UserSettings {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT deepgram_model, actions_llm_model, chatbot_llm_model FROM user_settings WHERE user_id = ?",
    )
    .get(userId) as
    | { deepgram_model: string; actions_llm_model: string; chatbot_llm_model: string }
    | undefined;

  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    deepgramModel: row.deepgram_model,
    actionsLlmModel: row.actions_llm_model,
    chatbotLlmModel: row.chatbot_llm_model,
  };
}

export function updateUserSettings(
  userId: string,
  updates: Partial<UserSettings>,
): UserSettings {
  const db = getDb();
  const defined = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined),
  );
  const merged = { ...getUserSettings(userId), ...defined };
  db.prepare(
    `INSERT INTO user_settings (user_id, deepgram_model, actions_llm_model, chatbot_llm_model)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       deepgram_model = excluded.deepgram_model,
       actions_llm_model = excluded.actions_llm_model,
       chatbot_llm_model = excluded.chatbot_llm_model,
       updated_at = datetime('now')`,
  ).run(userId, merged.deepgramModel, merged.actionsLlmModel, merged.chatbotLlmModel);
  return merged;
}
