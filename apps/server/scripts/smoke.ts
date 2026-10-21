import { startTestServer } from "../test/helpers.js";

const c = await startTestServer();
console.log("started", c.baseUrl);
const r = await fetch(c.baseUrl + "/api/health");
console.log("health", r.status, await r.text());
await c.close();
console.log("closed");
process.exit(0);
