import postgres, { type Sql } from "npm:postgres@3.4.9";
import { databaseUrl } from "./config.ts";

let client: Sql | undefined;

export function database(): Sql {
  client ??= postgres(databaseUrl(), {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return client;
}
