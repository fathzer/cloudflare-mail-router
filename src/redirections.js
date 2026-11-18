/**
 * Redirection table: validation and resolution.
 *
 * The table is a JSON object with a `redirections` object, whose keys are the addresses that receive mails
 * and whose values are the destination (a string) or the destinations (a non
 * empty array of strings) the mails are forwarded to, and an optional `pending` array:
 *
 *   {
 *     "redirections": { "a@example.com": "me@gmail.com", "b@example.com": ["a@example.com", "you@gmail.com"] },
 *     "pending": ["you@gmail.com"]
 *   }
 *
 * A destination that is itself a key of `redirections` is an alias: it is resolved
 * recursively. A destination that is not a key is final and must be an external
 * address (an address of a domain managed by the table must be a key).
 *
 * The pending destinations are final addresses that may not be verified by Cloudflare yet
 * (for instance because their owner did not click on the validation link).
 *
 * This module has no dependency and no I/O, so it can be used as is by the
 * command line validator, the tests and the Cloudflare worker.
 */

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Maximum depth of a chain of aliases (protects the worker even if the table is not validated). */
export const MAX_DEPTH = 10;

/**
 * Checks that a string is a plain, lowercase, email address (no display name, no comment, no quotes).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEmailAddress(value) {
  if (typeof value !== 'string') return false;
  const at = value.lastIndexOf('@');
  if (at < 1 || value.indexOf('@') !== at) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return local.length <= 64 && domain.length <= 253 && LOCAL_PART.test(local) && DOMAIN.test(domain);
}

/**
 * Returns the keys that appear more than once in the same object of a JSON text.
 * `JSON.parse` silently keeps the last one, so it can't be used to detect them.
 * @param {string} text The JSON text
 * @returns {string[]}
 */
export function findDuplicateKeys(text) {
  const duplicates = new Set();
  /** The keys already seen in the enclosing objects (null for an array). */
  const scopes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      scopes.push(new Set());
    } else if (c === '[') {
      scopes.push(null);
    } else if (c === '}' || c === ']') {
      scopes.pop();
    } else if (c === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          value += text[j++];
        }
        value += text[j++];
      }
      i = j;
      const scope = scopes[scopes.length - 1];
      if (scope && /^\s*:/.test(text.slice(j + 1, j + 64))) {
        let key;
        try {
          key = JSON.parse(`"${value}"`);
        } catch {
          key = value;
        }
        if (scope.has(key)) duplicates.add(key);
        scope.add(key);
      }
    }
  }
  return [...duplicates];
}

/** @returns {string[]} the destinations of an entry, or null if the entry is not valid */
function destinationsOf(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) return value;
  return null;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Splits a table in its redirections and its pending destinations.
 * No validation is done here (see {@link validate}), but the result is always usable.
 * @param {unknown} table
 * @returns {{redirections: Record<string, string|string[]>, pending: string[]}}
 */
export function tableParts(table) {
  return {
    redirections: isPlainObject(table?.redirections) ? table.redirections : {},
    pending: Array.isArray(table?.pending) ? table.pending.filter((p) => typeof p === 'string') : [],
  };
}

/** Validates the structure of the table. */
function validateStructure(table) {
  const errors = [];
  if (!isPlainObject(table)) return ['The table must be a JSON object'];
  if (!Object.hasOwn(table, 'redirections')) return ['The table must have a "redirections" key'];
  for (const key of Object.keys(table)) {
    if (key !== 'redirections' && key !== 'pending') errors.push(`Unknown key: ${JSON.stringify(key)}`);
  }
  if (!isPlainObject(table.redirections)) errors.push('"redirections" must be a JSON object');
  if (Object.hasOwn(table, 'pending') && !(Array.isArray(table.pending) && table.pending.every((p) => typeof p === 'string'))) {
    errors.push('"pending" must be an array of addresses');
  }
  return errors;
}

/**
 * Validates a redirection table.
 * @param {unknown} table The parsed table
 * @returns {string[]} The errors, empty if the table is valid
 */
export function validate(table) {
  const errors = validateStructure(table);
  if (errors.length > 0) return errors;
  const { redirections, pending } = tableParts(table);

  const sources = Object.keys(redirections);
  if (sources.length === 0) errors.push('The table is empty');
  const domains = new Set(sources.filter(isEmailAddress).map((s) => s.slice(s.indexOf('@') + 1)));

  /** @type {Map<string, string[]>} */
  const graph = new Map();
  const used = new Set();
  for (const source of sources) {
    if (!isEmailAddress(source)) {
      errors.push(`Invalid source address: ${JSON.stringify(source)} (must be a lowercase address)`);
    }
    const destinations = destinationsOf(redirections[source]);
    if (!destinations) {
      errors.push(`${source}: the value must be an address or a non empty array of addresses`);
      continue;
    }
    const seen = new Set();
    for (const destination of destinations) {
      used.add(destination);
      if (!isEmailAddress(destination)) {
        errors.push(`${source}: invalid destination address ${JSON.stringify(destination)} (must be a lowercase address)`);
      } else if (seen.has(destination)) {
        errors.push(`${source}: duplicate destination ${destination}`);
      } else if (!Object.hasOwn(redirections, destination) && domains.has(destination.slice(destination.indexOf('@') + 1))) {
        errors.push(`${source}: ${destination} is an address of a managed domain that is not in the table`);
      }
      seen.add(destination);
    }
    graph.set(source, destinations.filter((d) => Object.hasOwn(redirections, d)));
  }

  const seenPending = new Set();
  for (const address of pending) {
    if (!isEmailAddress(address)) {
      errors.push(`Invalid pending address: ${JSON.stringify(address)} (must be a lowercase address)`);
    } else if (seenPending.has(address)) {
      errors.push(`Duplicate pending address: ${address}`);
    } else if (Object.hasOwn(redirections, address)) {
      errors.push(`Pending address ${address} is a source of the table: only a final destination can be pending`);
    } else if (!used.has(address)) {
      errors.push(`Pending address ${address} is not the destination of any redirection`);
    }
    seenPending.add(address);
  }

  errors.push(...findCycles(graph).map((cycle) => `Cycle: ${cycle.join(' -> ')}`));
  return errors;
}

/**
 * Finds the cycles of a graph (each one is reported once, as a closed path).
 * @param {Map<string, string[]>} graph
 * @returns {string[][]}
 */
function findCycles(graph) {
  const cycles = [];
  const done = new Set();
  const path = [];
  const onPath = new Set();
  const visit = (node) => {
    if (onPath.has(node)) {
      cycles.push([...path.slice(path.indexOf(node)), node]);
      return;
    }
    if (done.has(node)) return;
    path.push(node);
    onPath.add(node);
    for (const next of graph.get(node) ?? []) visit(next);
    path.pop();
    onPath.delete(node);
    done.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}

/**
 * Computes the final addresses a mail sent to an address must be forwarded to.
 * Never trust the table: a cycle or a chain that is too deep throws an error.
 * @param {unknown} table The redirection table
 * @param {string} address The recipient of the mail
 * @returns {string[]|null} The final destinations (sorted), or null if the address is not in the table (the mail must be rejected)
 */
export function resolve(table, address) {
  const { redirections } = tableParts(table);
  const start = address.toLowerCase();
  if (!Object.hasOwn(redirections, start)) return null;
  const result = new Set();
  const walk = (current, path) => {
    if (path.length > MAX_DEPTH) throw new Error(`Redirections too deep: ${path.join(' -> ')}`);
    if (path.includes(current)) throw new Error(`Redirection cycle: ${[...path, current].join(' -> ')}`);
    if (!Object.hasOwn(redirections, current)) {
      result.add(current);
      return;
    }
    const destinations = destinationsOf(redirections[current]);
    if (!destinations) throw new Error(`Invalid entry for ${current}`);
    for (const destination of destinations) walk(destination, [...path, current]);
  };
  walk(start, []);
  return [...result].sort();
}

/**
 * Computes all the final addresses the table can forward mails to.
 * @param {unknown} table The redirection table
 * @returns {string[]} The final destinations (sorted, without duplicates)
 */
export function finalDestinations(table) {
  return [...new Set(Object.keys(tableParts(table).redirections).flatMap((source) => resolve(table, source)))].sort();
}
