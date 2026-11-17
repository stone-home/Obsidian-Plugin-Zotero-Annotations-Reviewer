import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
	{
		ignores: [
			'node_modules/',
			'dist/',
			'coverage/',
			'main.js',
			'src/main.js',
			'*.js',
			'*.mjs',
			'playground/',
			'.claude/',
			'.cursor/',
			'src/**/*.test.ts',
			'__mocks__/',
		],
	},
	js.configs.recommended,
	...tsPlugin.configs['flat/recommended'],
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ args: 'none', caughtErrors: 'none' },
			],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					'ts-expect-error': 'allow-with-description',
					'ts-ignore': true,
					'ts-nocheck': true,
				},
			],
			'no-prototype-builtins': 'off',
		},
	},
];
