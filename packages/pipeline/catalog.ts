import { parseArgs } from "node:util";
import { nextDecision } from "./decision-table.ts";
import { catalogRoute } from "./routes.ts";

const { values } = parseArgs({ options: { catalog: { type: "string" }, text: { type: "string" } } });
console.log(JSON.stringify(nextDecision(catalogRoute, values)));
