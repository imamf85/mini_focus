import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "mf_session";
export const SESSION_TTL_SEC = 12 * 60 * 60;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(name: string, secret: string): Promise<string> {
  return new SignJWT({ name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key(secret));
}

export async function verifySession(token: string | undefined, secret: string): Promise<{ name: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return typeof payload.name === "string" ? { name: payload.name } : null;
  } catch {
    return null;
  }
}
