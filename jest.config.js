/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	moduleNameMapper: {
		'^obsidian$': '<rootDir>/__mocks__/obsidian.ts',
	},
	transform: {
		// Cleaned up transform: removing the deprecated 'isolatedModules' option
		'^.+\\.tsx?$': ['ts-jest', {}],
	},
	collectCoverage: true,
	collectCoverageFrom: [
		'src/**/*.ts',
		'!src/types.ts',
		'!src/**/*.d.ts',
		'!src/settings.ts',
		'!src/ui/**/*.ts',
		'!src/main.ts'
	],
	coverageThreshold: {
		global: {
			statements: 75,
			branches: 55,
			functions: 85,
			lines: 80
		}
	},
};
