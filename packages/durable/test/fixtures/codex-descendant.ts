// Owned test descendant: ignore cooperative shutdown and self-expire if parent/test cleanup fails.
process.on("SIGTERM", () => {});
setTimeout(() => process.exit(0), 15_000);
if (!process.send) throw new Error("Expected parent IPC channel");
process.send("ready");
