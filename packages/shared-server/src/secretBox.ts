import crypto from "node:crypto";

import serverConfig from "@karakeep/shared/config";

/**
 * Fork: keeps a secret (an Instagram browser session — as good as the
 * account's password) unreadable at rest. AES-256-GCM, with a key derived
 * from the server's own secret (NEXTAUTH_SECRET), which the web app and the
 * workers share. Change that secret and what was sealed can't be opened any
 * more: the user pastes it again.
 */

const VERSION = "v1";

function key(secret: string, purpose: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      secret,
      Buffer.from("karakeep-secret-box"),
      purpose,
      32,
    ),
  );
}

export function sealSecret(
  plain: string,
  purpose: string,
  secret: string = serverConfig.signingSecret(),
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, data, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

/** Null when it can't be opened (tampered with, or another secret). */
export function openSecret(
  sealed: string,
  purpose: string,
  secret: string = serverConfig.signingSecret(),
): string | null {
  const [version, iv, data, tag] = sealed.split(":");
  if (version !== VERSION || !iv || !data || !tag) {
    return null;
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key(secret, purpose),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
