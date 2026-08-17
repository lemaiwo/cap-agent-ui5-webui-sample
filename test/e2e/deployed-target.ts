import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const AUTH_DIR = join(process.cwd(), ".auth")
export const STORAGE_STATE = join(AUTH_DIR, "deployed.json")
const TARGET_FILE = join(AUTH_DIR, "target.json")

/**
 * Which deployment the deployed tests run against.
 *
 * SAMPLE_DEPLOYED_URL wins, but `npm run login` also records the URL it logged
 * into, so the tests work afterwards with no environment variable at all. That
 * matters more than it sounds: `VAR=x npm test` is a POSIX shell form, and this
 * project is developed on Windows, where it silently is not a thing.
 */
export function resolveDeployedUrl(): string | undefined {
  const fromEnv = process.env.SAMPLE_DEPLOYED_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")

  if (!existsSync(TARGET_FILE)) return undefined
  try {
    const { url } = JSON.parse(readFileSync(TARGET_FILE, "utf8")) as { url?: string }
    return url?.replace(/\/$/, "")
  } catch {
    return undefined
  }
}

export const hasSavedSession = (): boolean => existsSync(STORAGE_STATE)
