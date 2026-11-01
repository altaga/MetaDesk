export interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  META_BASE_URL: string;
  TAVILY_KEY_CAP: string;
  BOOTSTRAP_USERNAME: string;
  BOOTSTRAP_PASSWORD?: string;
  JWT_SECRET: string;
  META_API_KEY?: string;
  TAVILY_API_KEY?: string;
  /** Set to "required" to enforce X-Desk-Signature on gateway routes. */
  GATEWAY_HMAC?: string;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
