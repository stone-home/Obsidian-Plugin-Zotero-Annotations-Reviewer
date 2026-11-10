import {
	DigestFiles,
	DigestInput,
	DigestInvalidLine,
	DigestRecord,
	DigestStatus,
	DigestStoreData,
} from './digest-types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INVALID_LINES = 500;

/** Normalised form used to compare keys and DOIs. */
export function normaliseId(value: string): string {
	return value.trim().toLowerCase();
}

function emptyData(): DigestStoreData {
	return { version: 1, records: {}, invalid: [] };
}

/** What the user chose when accepting a paper. */
export type DigestAcceptDecision = {
	directions: string[];
	collections: { key: string; name: string }[];
	zoteroKey: string;
};

/**
 * The digest store: every unchecked paper plus recently decided ones, kept in
 * a single JSON file owned by the plugin.
 */
export class DigestStore {
	private data: DigestStoreData = emptyData();

	constructor(
		private readonly files: DigestFiles,
		private readonly path: string,
		private readonly now: () => Date = () => new Date()
	) {}

	/**
	 * Loads the store from disk. A missing file yields an empty store.
	 * @throws Error when the file exists but is not a valid store, so that a
	 * damaged file is never silently overwritten.
	 */
	async load(): Promise<void> {
		if (!(await this.files.exists(this.path))) {
			this.data = emptyData();
			return;
		}
		const text = await this.files.read(this.path);
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			throw new Error(`Digest store is not valid JSON: ${(e as Error).message}`);
		}
		const candidate = parsed as Partial<DigestStoreData> | null;
		if (!candidate || typeof candidate.records !== 'object' || !candidate.records) {
			throw new Error('Digest store has an unexpected shape.');
		}
		this.data = {
			version: 1,
			records: candidate.records,
			invalid: Array.isArray(candidate.invalid) ? candidate.invalid : [],
		};
	}

	/** Writes the store to disk. */
	async save(): Promise<void> {
		await this.files.write(this.path, JSON.stringify(this.data));
	}

	/** Records in one state, oldest first. */
	list(status: DigestStatus): DigestRecord[] {
		return Object.values(this.data.records)
			.filter((record) => record.status === status)
			.sort((a, b) => a.added_at.localeCompare(b.added_at));
	}

	/** Looks a record up by its key. */
	get(key: string): DigestRecord | undefined {
		return this.data.records[normaliseId(key)];
	}

	/** Number of records in each state. */
	counts(): Record<DigestStatus, number> {
		const counts: Record<DigestStatus, number> = {
			unchecked: 0,
			accepted: 0,
			rejected: 0,
		};
		for (const record of Object.values(this.data.records)) counts[record.status]++;
		return counts;
	}

	/** The stored record that has the same key or the same DOI, in any state. */
	findDuplicate(input: DigestInput): DigestRecord | undefined {
		const byKey = this.data.records[normaliseId(input.key)];
		if (byKey) return byKey;
		if (!input.doi) return undefined;
		const doi = normaliseId(input.doi);
		return Object.values(this.data.records).find(
			(record) => record.doi !== undefined && normaliseId(record.doi) === doi
		);
	}

	/**
	 * Adds a paper as unchecked.
	 * @returns false when it duplicates a stored record and was not added.
	 */
	add(input: DigestInput, batch?: string): boolean {
		if (this.findDuplicate(input)) return false;
		const record: DigestRecord = {
			...input,
			status: 'unchecked',
			added_at: this.now().toISOString(),
		};
		if (batch) record.batch = batch;
		this.data.records[normaliseId(input.key)] = record;
		return true;
	}

	/** Marks a paper as rejected with a reason id. */
	reject(key: string, reason: string): void {
		const record = this.require(key);
		record.status = 'rejected';
		record.reject_reason = reason;
		record.decided_at = this.now().toISOString();
	}

	/** Marks a paper as accepted and stores what was written to Zotero. */
	accept(key: string, decision: DigestAcceptDecision): void {
		const record = this.require(key);
		record.status = 'accepted';
		record.directions = decision.directions;
		record.collections = decision.collections;
		record.zotero_key = decision.zoteroKey;
		record.decided_at = this.now().toISOString();
	}

	/** Returns a decided paper to the unchecked state and clears the decision. */
	restore(key: string): void {
		const record = this.require(key);
		record.status = 'unchecked';
		delete record.reject_reason;
		delete record.decided_at;
		delete record.directions;
		delete record.collections;
		delete record.zotero_key;
	}

	/** Import batches that still have unchecked papers. */
	batches(): string[] {
		const names = new Set<string>();
		for (const record of this.list('unchecked')) {
			if (record.batch) names.add(record.batch);
		}
		return Array.from(names).sort();
	}

	/**
	 * Deletes the still-unchecked papers of one import batch.
	 * @returns the number of papers removed.
	 */
	withdrawBatch(batch: string): number {
		return this.deleteWhere(
			(record) => record.status === 'unchecked' && record.batch === batch
		);
	}

	/**
	 * Deletes decided papers older than the retention period. Unchecked papers
	 * are never deleted here.
	 * @returns the number of papers removed.
	 */
	cleanup(retentionDays: number): number {
		if (!(retentionDays > 0)) return 0;
		const cutoff = this.now().getTime() - retentionDays * DAY_MS;
		return this.deleteWhere((record) => {
			if (record.status === 'unchecked' || !record.decided_at) return false;
			const decided = Date.parse(record.decided_at);
			return !Number.isNaN(decided) && decided < cutoff;
		});
	}

	/** Lines that failed validation and have not been cleared yet. */
	invalidLines(): DigestInvalidLine[] {
		return this.data.invalid;
	}

	/** Keeps a line that failed validation so the user can inspect it. */
	addInvalid(raw: string, reason: string, file: string): void {
		this.data.invalid.push({ raw, reason, file, at: this.now().toISOString() });
		if (this.data.invalid.length > MAX_INVALID_LINES) {
			this.data.invalid = this.data.invalid.slice(-MAX_INVALID_LINES);
		}
	}

	/** Discards all kept invalid lines. */
	clearInvalid(): void {
		this.data.invalid = [];
	}

	private require(key: string): DigestRecord {
		const record = this.get(key);
		if (!record) throw new Error(`Paper not found in digest store: ${key}`);
		return record;
	}

	private deleteWhere(predicate: (record: DigestRecord) => boolean): number {
		let removed = 0;
		for (const [id, record] of Object.entries(this.data.records)) {
			if (predicate(record)) {
				delete this.data.records[id];
				removed++;
			}
		}
		return removed;
	}
}
