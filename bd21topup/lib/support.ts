export type SupportCase = {
  supportId: string;
  status: "open" | "resolved" | "closed";
  reason: string;
  contactUrl: string | null;
};

// Require the actual end of input: JavaScript's `$` alone accepts a final newline.
export const SUPPORT_ID_PATTERN = /^BD21-(ORD|ADD|WDR)-[0-9A-F]{12}(?![\s\S])/;

export function supportPermission(supportId: string): string | null {
  if (!SUPPORT_ID_PATTERN.test(supportId)) return null;
  return { ORD: "manage_orders", ADD: "manage_add_money", WDR: "manage_withdrawals" }[
    supportId.split("-")[1] as "ORD" | "ADD" | "WDR"
  ];
}

// This is the existing public support account. No token or user data is in the URL.
export function supportContactUrl(
  supportId: string,
  username = "BD21Support",
  mode = "chat",
): string | null {
  if (!SUPPORT_ID_PATTERN.test(supportId) || !/^[A-Za-z][A-Za-z0-9_]{4,31}(?![\s\S])/.test(username)) return null;
  if (mode !== "chat" && mode !== "bot") return null;
  const url = new URL(`https://t.me/${username}`);
  if (mode === "bot") {
    url.searchParams.set("start", supportId);
  } else {
    url.searchParams.set("text", `আমার Support ID: ${supportId}। এই বিষয়ে সহায়তা চাই। প্রয়োজনীয় রসিদ বা স্ক্রিনশট পাঠাব।`);
  }
  return url.toString();
}
