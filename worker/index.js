/**
 * Email worker: forwards the mails according to the redirection table stored in the KV key `mail.redirections`.
 *
 * - A recipient that is not in the table is rejected.
 * - A pending destination (an address that may not be verified by Cloudflare yet) is skipped if the forward fails,
 *   and used as soon as its owner verifies it. A recipient with no available destination is rejected.
 * - If the table can't be read or is not valid, or if all the forwards fail, the worker throws: nothing is
 *   forwarded to a wrong place and the mail is not silently dropped.
 */
import { findDuplicateKeys, resolve, tableParts, validate } from '../src/redirections.js';

export const KEY = 'mail.redirections';

/** The last table read, to avoid parsing and validating it again if it did not change. */
let cache = { text: null, table: null };

/**
 * Reads and validates the table. The table is never trusted, even if it was validated before being deployed.
 * @param {{get: (key: string, options?: object) => Promise<string|null>}} kv
 */
export async function loadTable(kv) {
  const text = await kv.get(KEY, { cacheTtl: 60 });
  if (text === null) throw new Error(`The KV key ${KEY} does not exist`);
  if (cache.text !== text) {
    let table;
    try {
      table = JSON.parse(text);
    } catch (e) {
      throw new Error(`The KV key ${KEY} is not valid JSON: ${e.message}`);
    }
    const errors = [...findDuplicateKeys(text).map((k) => `Duplicate source address: ${k}`), ...validate(table)];
    if (errors.length > 0) throw new Error(`The redirection table is not valid: ${errors.join('; ')}`);
    cache = { text, table };
  }
  return cache.table;
}

export default {
  /**
   * @param {{to: string, setReject: (reason: string) => void, forward: (to: string) => Promise<void>}} message
   * @param {{REDIRECTIONS: object}} env
   */
  async email(message, env) {
    const table = await loadTable(env.REDIRECTIONS);
    const destinations = resolve(table, message.to);
    if (destinations === null) {
      message.setReject('Unknown recipient');
      return;
    }
    const pending = new Set(tableParts(table).pending);
    let forwarded = 0;
    const failures = [];
    for (const destination of destinations) {
      try {
        await message.forward(destination);
        forwarded++;
      } catch (e) {
        if (pending.has(destination)) {
          console.log(`Pending destination skipped for ${message.to}: ${destination}: ${e.message}`);
        } else {
          failures.push(`${destination}: ${e.message}`);
        }
      }
    }
    if (forwarded === 0) {
      if (failures.length > 0) {
        throw new Error(`Unable to forward the mail sent to ${message.to}: ${failures.join('; ')}`);
      }
      message.setReject('Recipient address is not active yet');
      return;
    }
    // At least one forward worked: throwing would make the sender retry and duplicate the mail
    for (const failure of failures) console.error(`Forward failed for ${message.to}, ${failure}`);
  },
};
