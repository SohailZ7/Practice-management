// A fixed, synthetic key so tests that touch dedupe keys or encryption do not depend on the developer's .env.
process.env.PHI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.PHI_ENCRYPTION_KEY_ID = "t1";
