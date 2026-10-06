import { writeFileSync } from "node:fs";

import { makeSampleRepo } from "../src/test/sample-repo";

/** The sample repository the tests add by path; the database is prepared by the web server's command. */
export default async function globalSetup() {
    writeFileSync("e2e/.sample-path", await makeSampleRepo());
}
