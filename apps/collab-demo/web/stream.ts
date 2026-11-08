// Decode chunked fetch/SSE streams without treating network chunks as event boundaries.

/** Read data events, handling split UTF-8, CRLF, comments, and multiline data fields. */
export async function* sseData(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let buffer = "";
	let data: string[] = [];
	let eventSize = 0;
	for await (const chunk of chunks) {
		buffer += decoder.decode(chunk, { stream: true });
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline === -1) break;
			const line = buffer.slice(0, newline).replace(/\r$/, "");
			buffer = buffer.slice(newline + 1);
			eventSize += line.length;
			if (eventSize > 1024 * 1024) throw new Error("Stream event exceeds its limit");
			if (line === "") {
				if (data.length) yield data.join("\n");
				data = [];
				eventSize = 0;
			} else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
		}
		if (buffer.length + eventSize > 1024 * 1024) throw new Error("Stream event exceeds its limit");
	}
	decoder.decode();
	// An incomplete final event is discarded; reconnect retrieves a current snapshot.
}
