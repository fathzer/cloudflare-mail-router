import { finalDestinations, tableParts } from './redirections.js';

/**
 * Access to the destination addresses of the Cloudflare Email Routing.
 * Only the account level API is used (the token needs the "Email Routing Addresses: Read" permission).
 */

const API = 'https://api.cloudflare.com/client/v4';

/**
 * Lists the destination addresses of an account.
 * @param {{accountId: string, token: string, fetch?: typeof fetch}} options
 * @returns {Promise<{email: string, verified: string|null}[]>}
 */
export async function listDestinationAddresses({ accountId, token, fetch: fetcher = fetch }) {
  const addresses = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const response = await fetcher(`${API}/accounts/${accountId}/email/routing/addresses?per_page=50&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      const reason = (body.errors ?? []).map((e) => e.message).join('; ') || response.statusText;
      throw new Error(`Cloudflare API error (${response.status}): ${reason}`);
    }
    addresses.push(...body.result);
    totalPages = body.result_info?.total_pages ?? 1;
  }
  return addresses;
}

/**
 * Finds the destinations that are not verified Cloudflare destination addresses.
 * @param {string[]} destinations The addresses the table forwards to
 * @param {{email: string, verified: string|null}[]} known The destination addresses of the account
 * @returns {{address: string, reason: string}[]}
 */
export function findUnverified(destinations, known) {
  const byEmail = new Map(known.map((a) => [a.email.toLowerCase(), a]));
  const problems = [];
  for (const address of destinations) {
    const entry = byEmail.get(address);
    if (!entry) problems.push({ address, reason: 'not declared in Cloudflare' });
    else if (!entry.verified) problems.push({ address, reason: 'declared but not verified yet' });
  }
  return problems;
}

/**
 * Finds the addresses that are verified destination addresses.
 * @param {string[]} addresses
 * @param {{email: string, verified: string|null}[]} known The destination addresses of the account
 * @returns {string[]}
 */
export function findVerified(addresses, known) {
  const verified = new Set(known.filter((a) => a.verified).map((a) => a.email.toLowerCase()));
  return addresses.filter((address) => verified.has(address));
}

/**
 * Checks the final destinations of a table against the destination addresses of the Cloudflare account.
 * - A destination that is not pending must be a verified destination address.
 * - A pending destination must not be verified (it has to be removed from the pending destinations then).
 * @param {unknown} table The redirection table
 * @param {{email: string, verified: string|null}[]} known The destination addresses of the account
 * @returns {{problems: {address: string, reason: string}[], activeCount: number}} The problems (empty if the table can be deployed)
 */
export function checkDestinations(table, known) {
  const pending = new Set(tableParts(table).pending);
  const destinations = finalDestinations(table);
  const active = destinations.filter((d) => !pending.has(d));
  const problems = [
    ...findUnverified(active, known),
    ...findVerified([...pending], known).map((address) => ({ address, reason: 'is verified, remove it from the pending destinations' })),
  ];
  return { problems, activeCount: active.length };
}
