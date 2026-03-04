export function normalizePath(path: string): string {
	if (!path) return '';

	// Use forward slashes everywhere
	let normalized = path.replace(/\\/g, '/');

	// Collapse duplicate slashes
	normalized = normalized.replace(/\/+/g, '/');

	// Remove leading "./"
	if (normalized.startsWith('./')) {
		normalized = normalized.slice(2);
	}

	// Obsidian paths are vault-relative; strip a single leading slash
	if (normalized.startsWith('/')) {
		normalized = normalized.slice(1);
	}

	return normalized;
}

