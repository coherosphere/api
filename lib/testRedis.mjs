import { redis } from "./lib/redis";

(async () => {
  await redis.set("hello", "world");
  const value = await redis.get("hello");
  console.log("Redis says:", value);
})();
