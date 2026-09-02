import assert from "node:assert/strict";
import { assertAuthenticatedCventUrl } from "./web/lib/steel-auth";
import { readFileSync } from "node:fs";

assert.throws(() => assertAuthenticatedCventUrl("https://app.cvent.com/subscribers/Login.aspx?ReturnUrl=%2fsubscribers%2fdefault.aspx"), /still on the Cvent login/i);
assert.throws(() => assertAuthenticatedCventUrl("https://login.microsoftonline.com/example/login"), /not an authenticated Cvent page/i);
assert.doesNotThrow(() => assertAuthenticatedCventUrl("https://app.cvent.com/subscribers/default.aspx"));
const source = readFileSync("web/lib/steel-auth.ts", "utf8");
assert.match(source, /persist:\s*true/);
assert.match(source, /userDataDir/);
assert.doesNotMatch(source, /persistProfile/);
console.log("golden auth guard smoke passed");
