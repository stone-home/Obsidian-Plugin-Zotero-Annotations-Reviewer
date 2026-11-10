import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
	{
		ignores: ["node_modules/", "dist/", "coverage/", "main.js", "src/main.js"],
	},
	js.configs.recommended,
	...tsPlugin.configs["flat/recommended"],
	{
		files: ["**/*.ts"],
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
	{
		files: ["**/*.test.ts", "__mocks__/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
];
