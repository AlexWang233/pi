// Join OS shutdown signals with terminal Harness state so a failed store cannot leave a listening zombie host.
import type { Harness } from "@earendil-works/pi-durable";

type ShutdownSignals = {
	once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
	removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

/** End on a shutdown signal or Harness closure, rejecting storage failure without logging its potentially sensitive cause. */
export async function waitForHostShutdown(
	closed: Harness["closed"],
	signals: ShutdownSignals = process,
): Promise<void> {
	const stopped = Promise.withResolvers<void>();
	signals.once("SIGINT", stopped.resolve);
	signals.once("SIGTERM", stopped.resolve);
	try {
		await Promise.race([
			stopped.promise,
			closed.then((end) => {
				if (end.kind === "failed")
					throw new Error("Durable host failed; stop old writers and inspect storage before restarting");
			}),
		]);
	} finally {
		signals.removeListener("SIGINT", stopped.resolve);
		signals.removeListener("SIGTERM", stopped.resolve);
	}
}
