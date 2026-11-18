#!/usr/bin/env node
// Checks that all the final destinations of a redirection table (default: redirections.json)
// are verified destination addresses of the Cloudflare account.
// The pending destinations of the table are allowed not to be verified (yet), but are not allowed to be
// verified: once their owner verified them, they must be removed from the pending destinations.
// Needs the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.
import { readFileSync } from 'node:fs';
import { checkDestinations, listDestinationAddresses } from '../src/cloudflare.js';

const file = process.argv[2] ?? 'redirections.json';
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !accountId) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
  process.exit(2);
}

try {
  const table = JSON.parse(readFileSync(file, 'utf8'));
  const { problems, activeCount } = checkDestinations(table, await listDestinationAddresses({ accountId, token }));
  for (const { address, reason } of problems) console.error(`${address}: ${reason}`);
  if (problems.length > 0) process.exit(1);
  console.error(`${file}: the ${activeCount} active destination(s) are verified`);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
