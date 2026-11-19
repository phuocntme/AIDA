// AgentCard: subset of the ERC-8004 registration file (ERC-8004 is still a Draft; field names follow the draft of
// Nov 2026). On-chain the service list is written as `services`, the name the registration file uses; older cards
// that say `endpoints` are still read. `wallet` is an AIDA extension: where the agent wants to be paid.
export const CARD_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const DATA_PREFIX = "data:application/json;base64,";

export type Endpoint = { name: string; endpoint: string };
export type AgentCard = {
  type: typeof CARD_TYPE;
  name: string;
  description: string;
  image?: string;
  endpoints: Endpoint[];
  wallet: `0x${string}`;
};

export type CardResult = { ok: true; card: AgentCard } | { ok: false; errors: string[] };

const isHttp = (s: unknown) => typeof s === "string" && /^https?:\/\/\S+$/.test(s);

export function validateCard(input: unknown): CardResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["card must be a JSON object"] };
  }
  const c = input as Record<string, unknown>;
  const errors: string[] = [];
  if (c.type !== CARD_TYPE) errors.push(`type must be "${CARD_TYPE}"`);
  if (typeof c.name !== "string" || c.name.trim().length < 1 || c.name.length > 64) errors.push("name must be 1-64 characters");
  if (typeof c.description !== "string" || c.description.length > 500) errors.push("description must be a string of at most 500 characters");
  if (c.image !== undefined && !isHttp(c.image)) errors.push("image must be an http(s) URL");
  const services = c.services ?? c.endpoints;
  if (!Array.isArray(services)) {
    errors.push("endpoints must be an array");
  } else {
    services.forEach((e, i) => {
      const ep = e as Record<string, unknown> | null;
      if (!ep || typeof ep.name !== "string" || !ep.name || !isHttp(ep.endpoint)) {
        errors.push(`endpoints[${i}] needs a name and an http(s) endpoint`);
      }
    });
  }
  if (typeof c.wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(c.wallet)) errors.push("wallet must be a 0x address");
  if (errors.length) return { ok: false, errors };
  const card: AgentCard = {
    type: CARD_TYPE,
    name: c.name as string,
    description: c.description as string,
    ...(c.image ? { image: c.image as string } : {}),
    endpoints: (services as Endpoint[]).map((e) => ({ name: e.name, endpoint: e.endpoint })),
    wallet: c.wallet as `0x${string}`,
  };
  return { ok: true, card };
}

function utf8ToBase64(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

export function encodeCardURI(card: AgentCard): string {
  const { endpoints, wallet, ...rest } = card;
  // x402Support is false on purpose: AIDA's payments are x402-style in native AVAX, not the x402 `exact` scheme.
  const file = { ...rest, services: endpoints, x402Support: false, active: true, supportedTrust: ["reputation"], wallet };
  return DATA_PREFIX + utf8ToBase64(JSON.stringify(file));
}

/** Decodes and validates a data: card URI. Never throws. */
export function decodeCardURI(uri: string): CardResult {
  if (!uri.startsWith(DATA_PREFIX)) return { ok: false, errors: ["unsupported card URI (only data:application/json;base64)"] };
  try {
    return validateCard(JSON.parse(base64ToUtf8(uri.slice(DATA_PREFIX.length))));
  } catch (e) {
    return { ok: false, errors: [`card URI is not valid base64 JSON: ${(e as Error).message}`] };
  }
}

export { utf8ToBase64, base64ToUtf8 };
