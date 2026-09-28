import "server-only";

export type EkPayProvider = "bkash" | "nagad";

export type EkPayVerification = {
  verification_id: string;
  transaction_id: string;
  provider: EkPayProvider;
  amount: number;
  currency: "BDT";
  provider_timestamp: string;
  status: "UNUSED";
  expires_at: string;
};

export type EkPayConfirmation = Omit<
  EkPayVerification,
  "provider_timestamp" | "expires_at" | "status"
> & {
  status: "CONSUMED";
  consumed_at: string;
};

export type EkPayErrorCode =
  | "disabled"
  | "invalid_configuration"
  | "timeout"
  | "not_verifiable"
  | "conflict"
  | "unavailable";

export class EkPayError extends Error {
  constructor(
    public readonly code: EkPayErrorCode,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "EkPayError";
  }
}

type ClientOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type EkPayEnvelope<T> = { success: true; data: T };

function configuration(env: NodeJS.ProcessEnv) {
  if (env.EKPAY_ENABLED !== "true") throw new EkPayError("disabled", false);

  const key = env.EKPAY_API_KEY?.trim();
  const rawBaseUrl = env.EKPAY_API_BASE_URL?.trim();
  if (!key || !rawBaseUrl || key.startsWith("ek_live_") || !key.startsWith("ek_test_")) {
    throw new EkPayError("invalid_configuration", false);
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new EkPayError("invalid_configuration", false);
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new EkPayError("invalid_configuration", false);
  }
  return { baseUrl: baseUrl.toString().replace(/\/$/, ""), key };
}

function isVerification(value: unknown): value is EkPayVerification {
  const v = value as Partial<EkPayVerification> | null;
  return Boolean(
    v && /^vr_[a-f0-9]{32}$/.test(v.verification_id ?? "")
      && /^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$/.test(v.transaction_id ?? "")
      && (v.provider === "bkash" || v.provider === "nagad")
      && Number.isSafeInteger(v.amount) && Number(v.amount) > 0
      && v.currency === "BDT" && v.status === "UNUSED"
      && typeof v.provider_timestamp === "string" && typeof v.expires_at === "string",
  );
}

function isConfirmation(value: unknown): value is EkPayConfirmation {
  const v = value as Partial<EkPayConfirmation> | null;
  return Boolean(
    v && /^vr_[a-f0-9]{32}$/.test(v.verification_id ?? "")
      && /^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$/.test(v.transaction_id ?? "")
      && (v.provider === "bkash" || v.provider === "nagad")
      && Number.isSafeInteger(v.amount) && Number(v.amount) > 0
      && v.currency === "BDT" && v.status === "CONSUMED"
      && typeof v.consumed_at === "string",
  );
}

export function createEkPayClient(options: ClientOptions = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  async function post<T>(path: string, body: unknown, idempotencyKey: string, validate: (value: unknown) => value is T): Promise<T> {
    const { baseUrl, key } = configuration(env);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new EkPayError("unavailable", true);
      }
      if (!response.ok) {
        if (response.status === 409) throw new EkPayError("conflict", false);
        if (response.status >= 400 && response.status < 500) {
          throw new EkPayError("not_verifiable", false);
        }
        throw new EkPayError("unavailable", true);
      }
      const envelope = payload as Partial<EkPayEnvelope<T>>;
      if (envelope.success !== true || !validate(envelope.data)) {
        throw new EkPayError("unavailable", true);
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof EkPayError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new EkPayError("timeout", true);
      }
      throw new EkPayError("unavailable", true);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    verify(input: { transactionId: string; amountMinor: number; provider: EkPayProvider; idempotencyKey: string }) {
      return post("/v1/trx/verify", {
        transaction_id: input.transactionId,
        amount: input.amountMinor,
        provider: input.provider,
      }, input.idempotencyKey, isVerification);
    },
    confirm(input: { verificationId: string; idempotencyKey: string }) {
      return post("/v1/trx/confirm", {
        verification_id: input.verificationId,
      }, input.idempotencyKey, isConfirmation);
    },
  };
}

export const ekPayClient = createEkPayClient();
