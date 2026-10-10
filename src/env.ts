// Side-effect module. Anything that reads process.env must import this first, because
// a script that reaches for a variable without it sees nothing under tsx. Next loads
// .env.local itself, and loadEnvFile never overrides a variable that is already set.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    // absent is fine, defaults keep the repo runnable on a fresh clone
  }
}
