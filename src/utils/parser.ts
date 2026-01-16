// src/utils/parser.ts

/**
 * Robustly parses JSON, handling common issues like Windows paths in strings.
 */
export function parseImageMap(rawSource: string): Record<string, string> {
	if (!rawSource || rawSource.trim().length === 0) return {};

	const trimmed = rawSource.trim();

	try {
		// Attempt 1: Standard Parse
		return JSON.parse(trimmed);
	} catch (e) {
		console.warn("[Zotero Assistant] Standard JSON parse failed. Trying to sanitize Windows paths...", e);

		try {
			// Attempt 2: Sanitize Windows Paths
			// Replace single backslashes \ that are NOT followed by valid JSON escape chars
			const sanitized = trimmed.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
			return JSON.parse(sanitized);
		} catch (e2) {
			console.error("[Zotero Assistant] Fatal JSON Error:", e2);
			throw new Error((e as Error).message);
		}
	}
}
