import { readFileSync } from "node:fs";

const schemaUrl = new URL(
  "../../../contracts/market-observation-v1/visionassist_market_observation_v1.json",
  import.meta.url
);

export const marketObservationSchema = Object.freeze(
  JSON.parse(readFileSync(schemaUrl, "utf8"))
);
