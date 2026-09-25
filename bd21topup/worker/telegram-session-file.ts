import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readTelegramSession(path: string) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function writeTelegramSession(path: string, session: string) {
  if (!session) throw new Error("Telegram authentication did not produce a session.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${session}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}
