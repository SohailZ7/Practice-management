// Seeds FAKE rows (invented names and text) for a rehearsal or the staging run. Refuses production, always.
//   npx tsx scripts/unify-seed-fake.ts [--visits 6]     (local or staging database, empty or not)
import { guard } from "./guard";
guard({ name: "unify-seed-fake", neverProd: true });
import { arg, run } from "./unify-common";

run(async () => {
  const { db } = await import("../src/lib/db");
  const { seedFake } = await import("../src/lib/unify/fakeData");
  await seedFake(db as never, { visits: Number(arg("--visits") ?? 6) });
  console.log("SEEDED fake rows (invented names and text)");
});
