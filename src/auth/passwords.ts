import { hash, verify, Algorithm } from "@node-rs/argon2";

// argon2id with OWASP-recommended minimums (re-check current OWASP guidance before launch).
const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = (stored: string, pw: string) => verify(stored, pw).catch(() => false);

// Unknown-email logins still run one verify, so timing does not reveal which emails exist.
let dummy: string | undefined;
export async function dummyVerify(pw: string): Promise<void> {
  dummy ??= await hashPassword("not-a-real-password-just-timing");
  await verifyPassword(dummy, pw);
}
