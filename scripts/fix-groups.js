const Database = require("better-sqlite3");
const crypto = require("crypto");

const db = new Database("data/conveneai.db");
db.pragma("foreign_keys = ON");

const userId = "effd3c8e-a0b6-46f8-9519-abc177757b62";

// Find distinct group_names not in groups table
const orphaned = db
  .prepare(
    `SELECT DISTINCT r.group_name
     FROM recordings r
     WHERE r.user_id = ?
       AND r.group_name IS NOT NULL
       AND r.group_name != ''
       AND NOT EXISTS (
         SELECT 1 FROM groups g
         WHERE g.name = r.group_name AND g.user_id = r.user_id
       )`
  )
  .all(userId);

console.log("Creating missing groups:", orphaned.map((r) => r.group_name).join(", "));

const insertGroup = db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, ?)");
const updateRecording = db.prepare(
  "UPDATE recordings SET group_id = ? WHERE user_id = ? AND group_name = ? AND group_id IS NULL"
);

const tx = db.transaction(() => {
  for (const row of orphaned) {
    const groupId = crypto.randomUUID();
    insertGroup.run(groupId, userId, row.group_name);
    updateRecording.run(groupId, userId, row.group_name);
    console.log(`  Created: ${row.group_name}`);
  }
});
tx();

console.log("\nAll groups:");
const groups = db.prepare("SELECT id, name FROM groups ORDER BY name").all();
for (const g of groups) {
  const row = db.prepare("SELECT COUNT(*) as c FROM recordings WHERE group_id = ?").get(g.id);
  console.log(`  ${g.name} (${row.c} recordings)`);
}

db.close();
