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

// ======================================================
// Provider 1: SiamBhau
// Primary - 1000 checks/day
// ======================================================

async function checkWithSiamBhau(uid: string): Promise<ProviderResult> {
  try {
    const apiKey = process.env.SIAMBHAU_API_KEY;

    if (!apiKey) {
      console.error("SIAMBHAU_API_KEY is missing");

      return {
        success: false,
        message: "SiamBhau unavailable",
        unavailable: true,
      };
    }

    const url = new URL("https://siambhau69.eu.cc/freefireinfo/bhau");

    url.searchParams.set("uid", uid);
    url.searchParams.set("region", "BD");
    url.searchParams.set("key", apiKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    const text = await response.text();

    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("SIAMBHAU returned non-JSON response");

      return {
        success: false,
        message: "SiamBhau unavailable",
        unavailable: true,
      };
    }

    console.log("SIAMBHAU STATUS:", response.status);

    const username =
      data?.basicInfo?.nickname ||
      data?.basicinfo?.nickname ||
      data?.data?.basicInfo?.nickname ||
      data?.data?.basicinfo?.nickname ||
      data?.nickname ||
      data?.username ||
      data?.name;

    if (response.ok && username) {
      console.log("SIAMBHAU PLAYER FOUND:", username);

      return {
        success: true,
        uid,
        username: String(username),
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
      message: "SiamBhau unavailable",
      unavailable: true,
    };
  } catch (error) {
    console.error("SIAMBHAU UID ERROR:", error);

    return {
      success: false,
      message: "SiamBhau unavailable",
      unavailable: true,
    };
  }
}

// ======================================================
// Provider 2: GoXtop
// Backup - 100 checks/day
// ======================================================

async function checkWithGoXtop(uid: string): Promise<ProviderResult> {
  try {
    const apiKey = process.env.GOXTOP_API_KEY;

    if (!apiKey) {
      console.error("GOXTOP_API_KEY is missing");

      return {
        success: false,
        message: "GoXtop unavailable",
        unavailable: true,
      };
    }

    const url = new URL("https://goxtop.com/api/check/game-check");

    url.searchParams.set("code", "freefire_bd");
    url.searchParams.set("characterId", uid);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    const text = await response.text();

    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("GOXTOP returned non-JSON response");

      return {
        success: false,
        message: "GoXtop unavailable",
        unavailable: true,
      };
    }

    console.log("GOXTOP STATUS:", response.status);

    const username = data?.username || data?.nickname || data?.name;

    if (response.ok && username) {
      console.log("GOXTOP PLAYER FOUND:", username);

      return {
        success: true,
        uid,
        username: String(username),
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
      message: "GoXtop unavailable",
      unavailable: true,
    };
  } catch (error) {
    console.error("GOXTOP UID ERROR:", error);

    return {
      success: false,
      message: "GoXtop unavailable",
      unavailable: true,
    };
  }
}

// ======================================================
// Provider 3: FFbazar
// Last fallback
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
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
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

    const data = await response.json();

    console.log("FFBAZAR STATUS:", response.status);

    if (
      data?.error === false &&
      data?.status === 200 &&
      data?.msg === "id_found" &&
      data?.data?.username
    ) {
      console.log("FFBAZAR PLAYER FOUND:", data.data.username);

      return {
        success: true,
        uid: String(data.data.id || uid),
        username: String(data.data.username),
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
  // 1. SiamBhau
  const siamResult = await checkWithSiamBhau(uid);

  if (siamResult.success) {
    return siamResult;
  }

  // SiamBhau normally responded and says UID invalid
  if (!siamResult.unavailable) {
    return {
      success: false,
      message: siamResult.message,
    };
  }

  console.log("SiamBhau unavailable → trying GoXtop");

  // 2. GoXtop
  const goXtopResult = await checkWithGoXtop(uid);

  if (goXtopResult.success) {
    return goXtopResult;
  }

  // GoXtop normally responded and says UID invalid
  if (!goXtopResult.unavailable) {
    return {
      success: false,
      message: goXtopResult.message,
    };
  }

  console.log("GoXtop unavailable → trying FFbazar");

  // 3. FFbazar
  const ffBazarResult = await checkWithFFBazar(uid);

  if (ffBazarResult.success) {
    return ffBazarResult;
  }

  return {
    success: false,
    message: ffBazarResult.message,
  };
}
