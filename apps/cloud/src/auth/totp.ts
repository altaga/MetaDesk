const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(20))].map((b) => ALPHABET[b % 32]).join("");
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const msg = new ArrayBuffer(8);
  new DataView(msg).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** RFC 6238, 30 s steps, one step of drift either way. */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret);
  const step = Math.floor(Date.now() / 30_000);
  for (const drift of [-1, 0, 1]) {
    if ((await hotp(key, step + drift)) === code) return true;
  }
  return false;
}

export function otpauthUrl(username: string, secret: string): string {
  const label = encodeURIComponent(`MetaDesk:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=MetaDesk`;
}
