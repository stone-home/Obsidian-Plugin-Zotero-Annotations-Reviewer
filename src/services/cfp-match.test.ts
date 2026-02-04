import { App, TFile } from 'obsidian';
import { CFPService } from './cfp';

describe('CFPService conference matching', () => {
	let app: App;
	let settings: any;
	let saveSettings: jest.Mock;
	let service: CFPService;

	beforeEach(() => {
		app = new App();
		saveSettings = jest.fn().mockResolvedValue(undefined);
		settings = {
			cfpNoteDir: 'CFP',
			cfpDefaultTags: ['cfp'],
			cfpRefreshDays: 5,
			cfpSeriesRefreshDays: 30,
			cfpLastFetchTime: 0,
			cfpLastSeriesFetchTime: 0,
			cfpSeriesMap: {},
			cfpLastDailyRun: 0,
			cfpSeriesIndexLetters: [],
			cfpSeriesDataviewJSCode: '',
			cfpWikicfpUrls: [],
			cfpCcfddlUrls: [],
			cfpEasychairUrls: [],
			cfpOpenresearchUrls: []
		};
		service = new CFPService(app, () => settings, saveSettings);

		(app.vault.getMarkdownFiles as jest.Mock).mockReset();
		(app.metadataCache.getFileCache as jest.Mock).mockReset();
	});

	it('findBestMatchingCFPForConference returns null when no notes', async () => {
		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([]);

		const result = await service.findBestMatchingCFPForConference({
			conferenceName: 'SCA/HPCAsia 2026',
			place: 'Tokyo',
			year: 2026
		});

		expect(result.event).toBeNull();
	});

	it('findBestMatchingCFPForConference picks best match and series info', async () => {
		const seriesNote = new TFile() as any;
		seriesNote.path = 'CFP/SCAHPCAsia/SCAHPCAsia Series.md';
		const event2025 = new TFile() as any;
		event2025.path = 'CFP/SCAHPCAsia/SCAHPCAsia 2025.md';
		const eventOld = new TFile() as any;
		eventOld.path = 'CFP/SCAHPCAsia/SCAHPCAsia 2018.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([
			seriesNote,
			event2025,
			eventOld
		]);

		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === seriesNote) {
				return { frontmatter: { 'cfp-series': true } };
			}
			if (file === event2025) {
				return {
					frontmatter: {
						acronym: 'SCA/HPCAsia 2025',
						series: 'SCAHPCAsia Series',
						'full-name': 'SCA and HPC Asia 2025',
						location: 'Tokyo, Japan',
						start: '2025-03-01',
						end: '2025-03-04',
						submission_ddl: '2024-11-15',
						'cfp-source': 'wikicfp',
						url: 'https://example.com/2025'
					}
				};
			}
			if (file === eventOld) {
				return {
					frontmatter: {
						acronym: 'SCA/HPCAsia 2018',
						series: 'SCAHPCAsia Series',
						'full-name': 'SCA and HPC Asia 2018',
						location: 'Tokyo, Japan',
						start: '2018-03-01',
						end: '2018-03-04',
						submission_ddl: '2017-11-15',
						'cfp-source': 'wikicfp',
						url: 'https://example.com/2018'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			conferenceName: 'SCA/HPCAsia 2025',
			place: 'Tokyo',
			year: 2025
		});

		expect(result.event).not.toBeNull();
		expect(result.event!.item.acronym).toBe('SCA/HPCAsia 2025');
		expect(result.seriesNotePath).toBe('CFP/SCAHPCAsia/SCAHPCAsia Series.md');
		expect(result.latestSeriesDdl).toBe('2024-11-15');
	});

	it('acronymFromNote with no year returns series-only when Series note exists', async () => {
		const osdiSeries = new TFile() as any;
		osdiSeries.path = 'CFP/OSDI/OSDI Series.md';
		const osdi2026 = new TFile() as any;
		osdi2026.path = 'CFP/OSDI/OSDI 2026.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([osdiSeries, osdi2026]);
		(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
			if (path === 'CFP/OSDI/OSDI Series.md') return osdiSeries;
			return null;
		});

		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === osdiSeries) return { frontmatter: { 'cfp-series': true } };
			if (file === osdi2026) {
				return {
					frontmatter: {
						acronym: 'OSDI 2026',
						series: 'OSDI',
						'full-name': 'OSDI 2026',
						location: 'CA',
						start: '2026-10-01',
						end: '2026-10-04',
						submission_ddl: '2026-04-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			acronymFromNote: 'OSDI'
			// no year: should not pick OSDI 2026; show Series only
		});

		expect(result.event).toBeNull();
		expect(result.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
		expect(result.latestSeriesDdl).toBe('2026-04-01');
	});

	it('acronymFromNote with year but no matching-year event returns series-only', async () => {
		const osdiSeries = new TFile() as any;
		osdiSeries.path = 'CFP/OSDI/OSDI Series.md';
		const osdi2026 = new TFile() as any;
		osdi2026.path = 'CFP/OSDI/OSDI 2026.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([osdiSeries, osdi2026]);
		(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
			if (path === 'CFP/OSDI/OSDI Series.md') return osdiSeries;
			return null;
		});

		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === osdiSeries) return { frontmatter: { 'cfp-series': true } };
			if (file === osdi2026) {
				return {
					frontmatter: {
						acronym: 'OSDI 2026',
						series: 'OSDI',
						'full-name': 'OSDI 2026',
						location: 'CA',
						start: '2026-10-01',
						end: '2026-10-04',
						submission_ddl: '2026-04-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			acronymFromNote: 'OSDI',
			year: 2010
		});

		expect(result.event).toBeNull();
		expect(result.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
	});

	it('acronymFromNote with year and matching event returns that event', async () => {
		const osdiSeries = new TFile() as any;
		osdiSeries.path = 'CFP/OSDI/OSDI Series.md';
		const osdi2010 = new TFile() as any;
		osdi2010.path = 'CFP/OSDI/OSDI 2010.md';
		const osdi2026 = new TFile() as any;
		osdi2026.path = 'CFP/OSDI/OSDI 2026.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([osdiSeries, osdi2010, osdi2026]);
		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === osdiSeries) return { frontmatter: { 'cfp-series': true } };
			if (file === osdi2010) {
				return {
					frontmatter: {
						acronym: 'OSDI 2010',
						series: 'OSDI',
						'full-name': '9th OSDI',
						location: 'Vancouver',
						start: '2010-10-01',
						end: '2010-10-04',
						submission_ddl: '2010-04-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			if (file === osdi2026) {
				return {
					frontmatter: {
						acronym: 'OSDI 2026',
						series: 'OSDI',
						'full-name': 'OSDI 2026',
						location: 'CA',
						start: '2026-10-01',
						end: '2026-10-04',
						submission_ddl: '2026-04-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			acronymFromNote: 'OSDI',
			year: 2010
		});

		expect(result.event).not.toBeNull();
		expect(result.event!.item.acronym).toBe('OSDI 2010');
		expect(result.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
		expect(result.latestSeriesDdl).toBe('2026-04-01');
	});

	it('acronymFromNote with no exact match and no series note returns null', async () => {
		const otherEvent = new TFile() as any;
		otherEvent.path = 'CFP/OTHER/OTHER 2025.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([otherEvent]);
		(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === otherEvent) {
				return {
					frontmatter: {
						acronym: 'OTHER 2025',
						series: 'OTHER',
						'full-name': 'Other Conf',
						location: 'X',
						submission_ddl: '2025-01-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			acronymFromNote: 'UNKNOWN'
		});

		expect(result.event).toBeNull();
		expect(result.seriesNotePath).toBeUndefined();
	});

	it('heuristic path clears best when note year does not match event year', async () => {
		const osdi2026 = new TFile() as any;
		osdi2026.path = 'CFP/OSDI/OSDI 2026.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([osdi2026]);
		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === osdi2026) {
				return {
					frontmatter: {
						acronym: 'OSDI 2026',
						series: 'OSDI',
						'full-name': 'OSDI 2026',
						location: 'CA',
						start: '2026-10-01',
						end: '2026-10-04',
						submission_ddl: '2026-04-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			conferenceName: 'OSDI 2010',
			year: 2010
		});

		expect(result.event).toBeNull();
	});

	it('acronymFromNote no year and no series note returns event null', async () => {
		const osdi2026 = new TFile() as any;
		osdi2026.path = 'CFP/OSDI/OSDI 2026.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([osdi2026]);
		(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === osdi2026) {
				return {
					frontmatter: {
						acronym: 'OSDI 2026',
						series: 'OSDI',
						'full-name': 'OSDI 2026',
						location: 'CA',
						start: '2026-10-01',
						end: '2026-10-04',
						submission_ddl: '2026-04-01',
						'cfp-source': 'wikicfp',
						url: 'u'
					}
				};
			}
			return null;
		});

		const result = await service.findBestMatchingCFPForConference({
			acronymFromNote: 'OSDI'
		});

		expect(result.event).toBeNull();
	});
});
