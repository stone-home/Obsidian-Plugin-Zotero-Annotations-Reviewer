/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	roots: ['<rootDir>/src', '<rootDir>/tests'],
	testMatch: ['<rootDir>/tests/**/*.test.ts'],
	moduleNameMapper: {
		'^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
	},
	transform: {
		'^.+\\.tsx?$': ['ts-jest', {}],
	},
	collectCoverage: true,
	collectCoverageFrom: [
		'src/**/*.ts',
		'!src/**/*.test.ts',
		'!src/types.ts',
		'!src/services/digest-types.ts',
		'!src/**/*.d.ts',
	],
	coverageThreshold: {
		global: {
			statements: 85,
			branches: 75,
			functions: 85,
			lines: 85,
		},
		'./src/services/': {
			statements: 85,
			branches: 85,
			functions: 85,
			lines: 85,
		},
		'./src/utils/': {
			statements: 85,
			branches: 85,
			functions: 85,
			lines: 85,
		},
	},
};
