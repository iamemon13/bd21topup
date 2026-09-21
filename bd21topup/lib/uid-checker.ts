export type UidCheckResult =
  | {
      success: true;
      uid: string;
      username: string;
      provider: string;
    }
  | {
      success: false;
      message: string;
    };

type ProviderResult =
  | {
      success: true;
      uid: string;
      username: string;
      provider: string;
    }
  | {
      success: false;
      message: string;
      unavailable: boolean;
    };

const MAX_RESPONSE_BYTES = 100_000;
const MAX_USERNAME_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const username = value.trim();

  if (!username) {
    return null;
  }

  return username.slice(0, MAX_USERNAME_LENGTH);
}

async function readJsonSafely(response: Response): Promise<unknown | null> {
  const contentLength = response.headers.get("content-length");

  if (contentLength) {
    const declaredSize = Number(contentLength);

    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
      return null;
    }
  }

  const text = await response.text();

  if (text.length > MAX_RESPONSE_BYTES) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// ======================================================
// Provider 1: SiamBhau
// ======================================================

async function checkWithSiamBhau(uid: string): Promise<ProviderResult> {
  try {
    const apiKey = process.env.SIAMBHAU_API_KEY;

    if (!apiKey) {
      console.error("SIAMBHAU_API_KEY is missing");

      return {
        success: false,
        message: "UID provider unavailable",
        unavailable: true,
      };
    }

    const url = new URL("https://siambhau69.eu.cc/freefireinfo/bhau");

    url.searchParams.set("uid", uid);
    url.searchParams.set("region", "BD");

    // Provider currently expects the key as a query parameter.
    // Never log this URL because it contains the secret.
    url.searchParams.set("key", apiKey);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    const parsed = await readJsonSafely(response);

    if (!parsed || !isRecord(parsed)) {
      console.error("SIAMBHAU returned invalid response");

      return {
        success: false,
        message: "UID provider unavailable",
        unavailable: true,
      };
    }

    const data = parsed;

    let username: string | null = null;

    const basicInfo = isRecord(data.basicInfo)
      ? data.basicInfo
      : isRecord(data.basicinfo)
        ? data.basicinfo
        : null;

    const nestedData = isRecord(data.data) ? data.data : null;

    const nestedBasicInfo =
      nestedData && isRecord(nestedData.basicInfo)
        ? nestedData.basicInfo
        : nestedData && isRecord(nestedData.basicinfo)
          ? nestedData.basicinfo
          : null;

    username =
      normalizeUsername(basicInfo?.nickname) ||
      normalizeUsername(nestedBasicInfo?.nickname) ||
      normalizeUsername(data.nickname) ||
      normalizeUsername(data.username) ||
      normalizeUsername(data.name);

    if (response.ok && username) {
      return {
        success: true,
        uid,
        username,
        provider: "siambhau",
      };
    }

    if (response.ok || response.status === 400 || response.status === 404) {
      return {
        success: false,
        message: "Free Fire UID পাওয়া যায়নি",
        unavailable: false,
      };
    }

    return {
      success: false,
      message: "UID provider unavailable",
      unavailable: true,
    };
  } catch (error) {
    console.error("SIAMBHAU UID ERROR:", error);

    return {
      success: false,
      message: "UID provider unavailable",
      unavailable: true,
    };
  }
}

// ======================================================
// Provider 2: GoXtop
// ======================================================

async function checkWithGoXtop(uid: string): Promise<ProviderResult> {
  try {
    const apiKey = process.env.GOXTOP_API_KEY;

    if (!apiKey) {
      console.error("GOXTOP_API_KEY is missing");

      return {
        success: false,
        message: "UID provider unavailable",
        unavailable: true,
      };
    }

    const url = new URL("https://goxtop.com/api/check/game-check");

    url.searchParams.set("code", "freefire_bd");
    url.searchParams.set("characterId", uid);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    const parsed = await readJsonSafely(response);

    if (!parsed || !isRecord(parsed)) {
      console.error("GOXTOP returned invalid response");

      return {
        success: false,
        message: "UID provider unavailable",
        unavailable: true,
      };
    }

    const username =
      normalizeUsername(parsed.username) ||
      normalizeUsername(parsed.nickname) ||
      normalizeUsername(parsed.name);

    if (response.ok && username) {
      return {
        success: true,
        uid,
        username,
        provider: "goxtop",
      };
    }

    if (response.ok || response.status === 400 || response.status === 404) {
      return {
        success: false,
        message: "Free Fire UID পাওয়া যায়নি",
        unavailable: false,
      };
    }

    return {
      success: false,
      message: "UID provider unavailable",
      unavailable: true,
    };
  } catch (error) {
    console.error("GOXTOP UID ERROR:", error);

    return {
      success: false,
      message: "UID provider unavailable",
      unavailable: true,
    };
  }
}

// ======================================================
// Provider 3: FFbazar
// ======================================================

async function checkWithFFBazar(uid: string): Promise<ProviderResult> {
  try {
    const response = await fetch(
      "https://apis.ffbazar.com/api/game-id-checker",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: "https://ffbazar.com",
          Referer: "https://ffbazar.com/",
          "User-Agent": "BD21Topup/1.0",
        },
        body: JSON.stringify({
          playerid: uid,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        success: false,
        message: "UID provider unavailable",
        unavailable: true,
      };
    }

    const parsed = await readJsonSafely(response);

    if (!parsed || !isRecord(parsed)) {
      return {
        success: false,
        message: "UID provider unavailable",
        unavailable: true,
      };
    }

    const nestedData = isRecord(parsed.data) ? parsed.data : null;

    const username = normalizeUsername(nestedData?.username);

    if (
      parsed.error === false &&
      parsed.status === 200 &&
      parsed.msg === "id_found" &&
      username
    ) {
      const returnedUid =
        typeof nestedData?.id === "string" || typeof nestedData?.id === "number"
          ? String(nestedData.id)
          : uid;

      return {
        success: true,
        uid: /^\d{5,15}$/.test(returnedUid) ? returnedUid : uid,
        username,
        provider: "ffbazar",
      };
    }

    return {
      success: false,
      message: "Free Fire UID পাওয়া যায়নি",
      unavailable: false,
    };
  } catch (error) {
    console.error("FFBAZAR UID ERROR:", error);

    return {
      success: false,
      message: "UID provider unavailable",
      unavailable: true,
    };
  }
}

// ======================================================
// Main UID Checker
// ======================================================

export async function checkFreeFireUid(uid: string): Promise<UidCheckResult> {
  if (!/^\d{5,15}$/.test(uid)) {
    return {
      success: false,
      message: "সঠিক Player UID লিখুন।",
    };
  }

  const siamResult = await checkWithSiamBhau(uid);

  if (siamResult.success) {
    return siamResult;
  }

  if (!siamResult.unavailable) {
    return {
      success: false,
      message: siamResult.message,
    };
  }

  const goXtopResult = await checkWithGoXtop(uid);

  if (goXtopResult.success) {
    return goXtopResult;
  }

  if (!goXtopResult.unavailable) {
    return {
      success: false,
      message: goXtopResult.message,
    };
  }

  const ffBazarResult = await checkWithFFBazar(uid);

  if (ffBazarResult.success) {
    return ffBazarResult;
  }

  return {
    success: false,
    message: ffBazarResult.message,
  };
}
