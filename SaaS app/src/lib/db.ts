import { PrismaClient } from "@prisma/client";
import { ENCRYPTED_FIELDS, assertNotFiltered, decryptResult, encryptData } from "./crypto/fields";
import { phi } from "./crypto/phi";

type Args = { data?: unknown; where?: unknown; create?: unknown; update?: unknown } & Record<string, unknown>;

/**
 * Prisma client with transparent field-level encryption (see src/lib/crypto/phi.ts): writes to the columns listed in
 * ENCRYPTED_FIELDS are encrypted, reads are decrypted, so call sites stay plain. Raw SQL ($queryRaw) bypasses this.
 */
export function createDb() {
  const base = new PrismaClient({ errorFormat: "minimal", log: ["error"] });
  return base.$extends({
    name: "phi-encryption",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const encrypted = model in ENCRYPTED_FIELDS;
          let next = args as Args;
          if (encrypted) {
            const cipher = phi;
            assertNotFiltered(model, next.where);
            const enc = (d: unknown) => (Array.isArray(d) ? d.map((x) => encryptData(cipher, model, x)) : encryptData(cipher, model, d));
            next = { ...next };
            if ("data" in next) next.data = enc(next.data);
            if (operation === "upsert") {
              next.create = enc(next.create);
              next.update = enc(next.update);
            }
          }
          const result = await query(next as typeof args);
          return decryptResult(phi, model, result) as typeof result;
        },
      },
    },
  });
}

export type Db = ReturnType<typeof createDb>;

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db = globalForPrisma.prisma ?? createDb();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
