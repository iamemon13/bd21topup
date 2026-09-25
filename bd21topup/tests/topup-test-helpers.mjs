import { readFileSync } from "node:fs";
import ts from "typescript";
export function load(path, imports = {}) {
  const js = ts.transpileModule(
    readFileSync(new URL("../" + path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)(
    (name) => {
      if (name === "server-only") return {};
      if (!(name in imports)) throw Error("Unexpected import " + name);
      return imports[name];
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
export const mappings = load("lib/topup-mappings.ts");
export const generator = load("lib/topup-preview.ts", {
  "@/lib/topup-mappings": mappings,
});
export const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/topup-mappings.json", import.meta.url),
    "utf8",
  ),
);
export const actor = "11111111-1111-4111-8111-111111111111";
export const order = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  uid: "123456789",
  package_name: "Weekly",
  amount: "158.00",
  status: "pending",
  payment_method: "wallet",
  cancelled_at: null,
};
export const pkg = { id: fixtures[0].id, name: "Weekly", category: "uid_bd" };
export const debit = {
  id: "44444444-4444-4444-8444-444444444444",
  reference_id: order.id,
  user_id: order.user_id,
  amount: 158,
  type: "order_payment",
  direction: "debit",
};
