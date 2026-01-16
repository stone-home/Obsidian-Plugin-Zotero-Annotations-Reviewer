/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: 'ts-jest',
	// 1. Change environment from 'node' to 'jsdom'
	testEnvironment: 'jsdom',
	moduleNameMapper: {
		'^obsidian$': '<rootDir>/__mocks__/obsidian.ts',
	},
	transform: {
		// 2. Configure ts-jest cleanly
		'^.+\\.tsx?$': ['ts-jest', {
			// "isolatedModules" is better set in tsconfig.json,
			// but if you must do it here, use the new syntax if the warning persists.
			// For now, let's keep the transform simple.
		}],
	},
	collectCoverage: true,
	collectCoverageFrom: [
		'src/main.ts',
		'src/settings.ts',
	],
};
