// Direct connections to the systems of record, used only for WRITES
// (confirming a shipment, logging a sent email, the simulator delivering
// a document). Agents read everything through Zetaris.

import { createHash } from "node:crypto";
import pg from "pg";
import mysql from "mysql2/promise";
import { config } from "../config.ts";

// Keep DATE columns as plain "YYYY-MM-DD" strings (no timezone shift).
pg.types.setTypeParser(1082, (value) => value);

export const ops = new pg.Pool({ connectionString: config.opsDbUrl, max: 5 });
export const finance = mysql.createPool({ uri: config.financeDbUrl, connectionLimit: 3, dateStrings: true });

export function contentHash(...parts: string[]): string {
  return createHash("md5").update(parts.map((p) => p.trim().toLowerCase().replace(/\s+/g, " ")).join("\n")).digest("hex");
}

export type MailRow = {
  message_id: string;
  direction: "inbound" | "outbound";
  from_addr: string;
  to_addr: string;
  subject: string;
  body: string;
  attachments: string;
  content_hash: string;
  case_id: string | null;
  sent_at: string;
  simulated: boolean;
};

export async function insertMail(mail: Omit<MailRow, "content_hash" | "simulated"> & { simulated?: boolean }): Promise<MailRow> {
  const row: MailRow = { ...mail, content_hash: contentHash(mail.from_addr, mail.subject.replace(/^(re|fwd?):\s*/i, ""), mail.body, mail.attachments), simulated: mail.simulated ?? true };
  await ops.query(
    `INSERT INTO mailbox (message_id, direction, from_addr, to_addr, subject, body, attachments, content_hash, case_id, sent_at, simulated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (message_id) DO NOTHING`,
    [row.message_id, row.direction, row.from_addr, row.to_addr, row.subject, row.body, row.attachments, row.content_hash, row.case_id, row.sent_at, row.simulated],
  );
  return row;
}
