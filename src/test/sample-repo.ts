import { makeRepo } from "./git-repo";

// Assembled at run time, so this file itself carries no secret for the pre-commit scan.
export const SAMPLE_KEY = ["8f3c9d2e", "7a1b4c6d", "9e0f1a2b", "3c4d5e6f"].join("");

/** One planted secret, one vulnerable dependency (lodash 4.17.15), one injection. */
export function makeSampleRepo(): Promise<string> {
    return makeRepo({
        "package.json": JSON.stringify(
            { name: "sample", version: "1.0.0", dependencies: { lodash: "4.17.15", express: "4.21.2" } },
            null,
            2
        ),
        "package-lock.json": JSON.stringify(
            {
                name: "sample",
                version: "1.0.0",
                lockfileVersion: 3,
                requires: true,
                packages: {
                    "": { name: "sample", version: "1.0.0", dependencies: { lodash: "4.17.15" } },
                    "node_modules/lodash": { version: "4.17.15", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz" }
                }
            },
            null,
            2
        ),
        "src/config.js": `module.exports = {\n    api_key: "${SAMPLE_KEY}"\n};\n`,
        "src/server.js": [
            'const express = require("express");',
            'const db = require("./db");',
            "const app = express();",
            'app.get("/user", (req, res) => {',
            '    db.query("SELECT * FROM users WHERE id = \'" + req.query.id + "\'").then(r => res.json(r));',
            "});",
            'app.get("/calc", (req, res) => res.send(String(eval(req.query.expr))));',
            "app.listen(3000);",
            ""
        ].join("\n")
    });
}
