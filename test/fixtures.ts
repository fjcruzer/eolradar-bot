import upcomingJson from "./fixtures/upcoming.json";
import eksJson from "./fixtures/eks.json";
import lambdaJson from "./fixtures/lambda-sample.json";
import notFoundJson from "./fixtures/not-found.json";
import servicesJson from "./fixtures/services.json";
import { parseServiceDetail, parseServiceIndex, parseUpcomingFeed } from "../src/core/client";
import type { ServiceDetail, ServiceIndex, UpcomingFeed } from "../src/core/types";

export const services: ServiceIndex = parseServiceIndex(servicesJson);
export const eks: ServiceDetail = parseServiceDetail(eksJson);
export const lambdaSample: ServiceDetail = parseServiceDetail(lambdaJson);
export const upcoming: UpcomingFeed = parseUpcomingFeed(upcomingJson);
export const notFoundBody = notFoundJson;
