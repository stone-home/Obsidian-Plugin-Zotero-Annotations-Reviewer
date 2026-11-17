import { CFPService } from '../../../src/services/cfp';
import { DEFAULT_SETTINGS, MyPluginSettings } from '../../../src/types';
import { createTestApp, TestAppHarness } from '../../fixtures/vault';

describe('CFPService conference matching and series/path lookups', () => {
	let harness: TestAppHarness;
	let settings: MyPluginSettings;
	let service: CFPService;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation(() => {});
		harness = createTestApp();
		settings = {
			...DEFAULT_SETTINGS,
			cfpNoteDir: 'CFP',
		};
		service = new CFPService(
			harness.app,
			() => settings,
			async () => undefined
		);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('findBestMatchingCFPForConference', () => {
		it('returns null event when CFP folder is empty or contains only series/invalid notes', async () => {
			await expect(
				service.findBestMatchingCFPForConference({
					conferenceName: 'OSDI 2026',
				})
			).resolves.toEqual({ event: null });

			harness.addFile('CFP/OSDI/OSDI Series.md', '', { 'cfp-series': true });
			harness.addFile('CFP/OSDI/broken.md', '', { location: 'Nowhere' });

			await expect(
				service.findBestMatchingCFPForConference({
					conferenceName: 'OSDI 2026',
				})
			).resolves.toEqual({ event: null });
		});

		it('scores heuristic conferenceName, year, and location matches and resolves latestSeriesDdl', async () => {
			harness.addFile('CFP/SCAHPCAsia/SCAHPCAsia Series.md', '', {
				'cfp-series': true,
			});
			harness.addFile('CFP/SCAHPCAsia/SCAHPCAsia 2025.md', '', {
				acronym: 'SCA/HPCAsia 2025',
				series: '[[SCAHPCAsia Series]]',
				'full-name': 'SCA and HPC Asia 2025',
				location: 'Tokyo, Japan',
				start: '2025-03-01',
				end: '2025-03-04',
				submission_ddl: '2024-11-15',
				'cfp-source': 'wikicfp',
				url: 'https://example.com/2025',
			});
			harness.addFile('CFP/SCAHPCAsia/SCAHPCAsia 2018.md', '', {
				acronym: 'SCA/HPCAsia 2018',
				series: '[[SCAHPCAsia Series]]',
				'full-name': 'SCA and HPC Asia 2018',
				location: 'Tokyo, Japan',
				start: '2018-03-01',
				end: '2018-03-04',
				submission_ddl: '2017-11-15',
				'cfp-source': 'wikicfp',
			});

			const match = await service.findBestMatchingCFPForConference({
				conferenceName: 'SCA/HPCAsia 2025',
				place: 'Tokyo',
				year: 2025,
			});

			expect(match.event?.item.acronym).toBe('SCA/HPCAsia 2025');
			expect(match.seriesNotePath).toBe('CFP/SCAHPCAsia/SCAHPCAsia Series.md');
			expect(match.latestSeriesDdl).toBe('2024-11-15');

			// Year mismatch clears heuristic match
			const wrongYear = await service.findBestMatchingCFPForConference({
				conferenceName: 'SCA/HPCAsia 2010',
				year: 2010,
			});
			expect(wrongYear).toEqual({ event: null });
		});

		it('handles acronymFromNote exact year matches, series-only fallbacks, and missing series notes', async () => {
			harness.addFile('CFP/OSDI/OSDI Series.md', '', { 'cfp-series': true });
			harness.addFile('CFP/OSDI/OSDI 2010.md', '', {
				acronym: 'OSDI 2010',
				series: 'OSDI',
				'full-name': '9th OSDI',
				location: 'Vancouver',
				start: '2010-10-01',
				submission_ddl: '2010-04-01',
				'cfp-source': 'wikicfp',
			});
			harness.addFile('CFP/OSDI/OSDI 2026.md', '', {
				acronym: 'OSDI 2026',
				series: 'OSDI',
				'full-name': 'OSDI 2026',
				location: 'CA',
				start: '2026-10-01',
				submission_ddl: '2026-04-01',
				'cfp-source': 'wikicfp',
			});

			// 1. Exact acronym + matching year -> returns matching event + latestSeriesDdl
			const withYear = await service.findBestMatchingCFPForConference({
				acronymFromNote: 'OSDI',
				year: 2010,
			});
			expect(withYear.event?.item.acronym).toBe('OSDI 2010');
			expect(withYear.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
			expect(withYear.latestSeriesDdl).toBe('2026-04-01');

			// 2. Acronym without year -> returns series-only fallback
			const withoutYear = await service.findBestMatchingCFPForConference({
				acronymFromNote: 'OSDI',
			});
			expect(withoutYear).toEqual({
				event: null,
				seriesNotePath: 'CFP/OSDI/OSDI Series.md',
				latestSeriesDdl: '2026-04-01',
			});

			// 3. Acronym with non-existent year -> returns series-only fallback
			const missingYear = await service.findBestMatchingCFPForConference({
				acronymFromNote: 'OSDI',
				year: 2014,
			});
			expect(missingYear).toEqual({
				event: null,
				seriesNotePath: 'CFP/OSDI/OSDI Series.md',
				latestSeriesDdl: '2026-04-01',
			});

			// 4. Unknown acronym without Series note -> returns { event: null }
			const unknown = await service.findBestMatchingCFPForConference({
				acronymFromNote: 'UNKNOWN_CONF',
			});
			expect(unknown).toEqual({ event: null });
		});

		it('extracts year from conferenceName or proceedingsTitle when meta.year is omitted', async () => {
			harness.addFile('CFP/OSDI/OSDI Series.md', '', { 'cfp-series': true });
			harness.addFile('CFP/OSDI/OSDI 2026.md', '', {
				acronym: 'OSDI 2026',
				title: 'OSDI 2026 title',
				submission_ddl: '2025-12-01',
			});

			const matched = await service.findBestMatchingCFPForConference({
				conferenceName: 'OSDI 2026',
			});
			expect(matched.event?.path).toBe('CFP/OSDI/OSDI 2026.md');

			const unmatched = await service.findBestMatchingCFPForConference({
				proceedingsTitle: 'OSDI 1999',
			});
			expect(unmatched).toEqual({ event: null });
		});
	});

	describe('getSeriesInfoByAcronym and getCFPNoteInfoByPath', () => {
		beforeEach(() => {
			harness.addFile('CFP/OSDI/OSDI Series.md', '', {
				'cfp-series': true,
				'series-url': 'http://program/osdi',
			});
			harness.addFile('CFP/OSDI/OSDI 2025.md', '', {
				acronym: 'OSDI 2025',
				series: '[[OSDI Series]]',
				'full-name': 'OSDI 2025 full',
				location: 'Boston',
				start: '2025-07-01',
				end: '2025-07-03',
				'submission-ddl': '2024-12-01',
				'cfp-source': 'wikicfp',
				url: 'http://osdi25',
			});
			harness.addFile('CFP/OSDI/OSDI 2026.md', '', {
				acronym: 'OSDI 2026',
				title: 'OSDI 2026 title',
				submission_ddl: '2025-12-01',
			});
			harness.addFile('CFP/OSDI/OSDI 2028.md', '', { acronym: 'OSDI 2028' });
			harness.addFile('CFP/OSDI/plain.md', '');
			harness.addFile('CFP/NSDI 2026.md', '', {
				acronym: 'NSDI 2026',
				submission_ddl: '2025-09-01',
			});
			harness.addFile('Notes/OSDI 2030.md', '', {
				acronym: 'OSDI 2030',
				submission_ddl: '2029-12-01',
			});
		});

		it('resolves Series note and latest event by plain acronym or year-suffixed acronym', () => {
			const direct = service.getSeriesInfoByAcronym(' OSDI ');
			expect(direct).not.toBeNull();
			expect(direct?.seriesName).toBe('OSDI');
			expect(direct?.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
			expect(direct?.latestEvent?.path).toBe('CFP/OSDI/OSDI 2026.md');

			const stripped = service.getSeriesInfoByAcronym('OSDI 2031');
			expect(stripped?.seriesName).toBe('OSDI');

			expect(service.getSeriesInfoByAcronym('   ')).toBeNull();
			expect(service.getSeriesInfoByAcronym('NSDI 2026')).toBeNull();
		});

		it('describes series notes, event notes, parent-folder fallback, and rejects out-of-scope paths', () => {
			const seriesInfo = service.getCFPNoteInfoByPath('CFP/OSDI/OSDI Series.md');
			expect(seriesInfo).toMatchObject({
				isSeries: true,
				seriesNotePath: 'CFP/OSDI/OSDI Series.md',
				seriesName: 'OSDI',
			});
			expect(seriesInfo?.latestEvent?.item.acronym).toBe('OSDI 2026');

			const eventInfo = service.getCFPNoteInfoByPath('CFP/OSDI/OSDI 2025.md');
			expect(eventInfo?.isSeries).toBe(false);
			if (eventInfo && !eventInfo.isSeries) {
				expect(eventInfo.event.item.acronym).toBe('OSDI 2025');
				expect(eventInfo.latestEvent?.item.acronym).toBe('OSDI 2026');
			}

			const folderFallback = service.getCFPNoteInfoByPath(
				'CFP/OSDI/OSDI 2028.md'
			);
			expect(folderFallback?.isSeries).toBe(false);
			expect(folderFallback?.latestEvent?.item.acronym).toBe('OSDI 2026');

			const acronymFallback = service.getCFPNoteInfoByPath('CFP/NSDI 2026.md');
			expect(acronymFallback?.isSeries).toBe(false);
			expect(acronymFallback?.latestEvent?.path).toBe('CFP/NSDI 2026.md');

			expect(service.getCFPNoteInfoByPath('Notes/OSDI 2030.md')).toBeNull();
			expect(service.getCFPNoteInfoByPath('CFP/missing.md')).toBeNull();
			expect(service.getCFPNoteInfoByPath('CFP/OSDI/plain.md')).toBeNull();
		});
	});
});
