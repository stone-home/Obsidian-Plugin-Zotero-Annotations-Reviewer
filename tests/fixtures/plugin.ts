import ZoteroGKPlugin from '../../src/main';
import { CFPService } from '../../src/services/cfp';
import { DataviewService } from '../../src/services/dataview';
import { ObsidianService } from '../../src/services/obsidian';
import { PaperHubService } from '../../src/services/paper-hub';
import { VaultLibraryService } from '../../src/services/vault-library';
import { WebhookService } from '../../src/services/webhook';
import { ZoteroService } from '../../src/services/zotero';
import {
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_SETTINGS,
	MyPluginSettings,
} from '../../src/types';
import { TestAppHarness } from './vault';

export function cloneDefaultSettings(
	overrides: Partial<MyPluginSettings> = {}
): MyPluginSettings {
	return {
		...DEFAULT_SETTINGS,
		metadataMapping: (
			overrides.metadataMapping ?? DEFAULT_SETTINGS.metadataMapping
		).map((m) => ({ ...m })),
		webhooks: (overrides.webhooks ?? DEFAULT_SETTINGS.webhooks).map((w) => ({
			...w,
			headers: [...w.headers],
		})),
		paperWorkspace: {
			...DEFAULT_PAPER_WORKSPACE,
			...(overrides.paperWorkspace ?? {}),
		},
		zoteroTemplate: {
			...DEFAULT_SETTINGS.zoteroTemplate,
			...(overrides.zoteroTemplate ?? {}),
		},
		prompts: (overrides.prompts ?? DEFAULT_SETTINGS.prompts).map((p) => ({
			...p,
		})),
		cfpWikicfpUrls: [...DEFAULT_SETTINGS.cfpWikicfpUrls],
		cfpCcfddlUrls: [...DEFAULT_SETTINGS.cfpCcfddlUrls],
		cfpEasychairUrls: [...DEFAULT_SETTINGS.cfpEasychairUrls],
		cfpOpenresearchUrls: [...DEFAULT_SETTINGS.cfpOpenresearchUrls],
		cfpSeriesMap: { ...DEFAULT_SETTINGS.cfpSeriesMap },
		cfpSeriesIndexLetters: [...DEFAULT_SETTINGS.cfpSeriesIndexLetters],
		cfpDefaultTags: [...DEFAULT_SETTINGS.cfpDefaultTags],
		...overrides,
	};
}

export function createTestPlugin(
	harness: TestAppHarness,
	overrides: Partial<MyPluginSettings> = {}
): ZoteroGKPlugin {
	const plugin = new ZoteroGKPlugin(harness.app, harness.manifest);
	plugin.settings = cloneDefaultSettings(overrides);
	plugin.zotero = new ZoteroService(plugin.settings.zoteroPort);
	plugin.obsidian = new ObsidianService(harness.app, plugin.settings);
	plugin.paperHub = new PaperHubService(harness.app, () => plugin.settings);
	plugin.vaultLibrary = new VaultLibraryService(
		harness.app,
		() => plugin.settings,
		plugin.paperHub
	);
	plugin.webhookService = new WebhookService(harness.app, () => plugin.settings);
	plugin.dataviewService = new DataviewService(harness.app);
	plugin.cfpService = new CFPService(
		harness.app,
		() => plugin.settings,
		() => plugin.saveSettings()
	);
	harness.attachPluginViews(plugin);
	return plugin;
}
