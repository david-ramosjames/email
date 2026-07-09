import crypto from "crypto";

const algorithm = "aes-256-gcm";

function key() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || "";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(value?: string | null) {
  if (!value) return value;
  if (value.startsWith("enc:")) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptToken(value?: string | null) {
  if (!value || !value.startsWith("enc:")) return value;

  const [, iv, tag, encrypted] = value.split(":");
  const decipher = crypto.createDecipheriv(
    algorithm,
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
