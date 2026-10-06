import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
        }
    },
    {
        // The engine runs under `pnpm eval` with no Next.js server (design § 5).
        files: ["src/engine/**"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["next", "next/*", "@/server/*", "@/app/*"],
                            message: "The engine imports nothing from Next.js or the app."
                        }
                    ]
                }
            ]
        }
    },
    globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "playwright-report/**", "test-results/**"]),
    prettier
]);

export default eslintConfig;
