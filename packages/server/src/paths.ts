import { homedir } from "node:os";
import { join } from "node:path";

/** Home of the self-contained install: embedded database and generated secrets. */
export function cvHome() {
  return process.env.CV_HOME || join(homedir(), ".cryptovision");
}

export function secretKeyPath() {
  return join(cvHome(), "secret.key");
}
