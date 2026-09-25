import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generator,
  mappings,
  fixtures,
  order,
  pkg,
  debit,
} from "./topup-test-helpers.mjs";
const generate = (o = order, p = [pkg], d = [debit]) =>
  generator.generateTopupPreview(o, p, d);
const blocked = (fn, code) => assert.throws(fn, (e) => e.code === code);

test("manifest contains precisely the 37 owner-approved UUIDs, no lvlall", () => {
  assert.equal(mappings.TOPUP_MAPPINGS.length, 37);
  assert.deepEqual(
    mappings.TOPUP_MAPPINGS.map((m) => m.packageId).sort(),
    fixtures.map((f) => f.id).sort(),
  );
  assert.ok(!JSON.stringify(mappings.TOPUP_MAPPINGS).includes("lvlall"));
});
for (const f of fixtures)
  test("exact owner fixture: " + f.name, () => {
    const result = generate({ ...order, package_name: f.name }, [f]);
    assert.deepEqual(
      result.operations,
      f.commands.map((command, i) => ({
        index: i + 1,
        command: command.replace("{uid}", order.uid),
      })),
    );
    assert.equal(result.mappingVersion, "bd21-kaium-v1");
  });
for (const uid of ["12345", "123456789012345"])
  test("UID accepted " + uid, () => assert.ok(generate({ ...order, uid })));
for (const uid of [
  "1234",
  "1234567890123456",
  " 12345",
  "12345 ",
  "12345\n",
  "123\n45",
  "abcde",
  "123;45",
  "১২৩৪৫",
  "１２３４５",
  12345,
  null,
])
  test("UID rejected " + JSON.stringify(uid), () =>
    blocked(() => generate({ ...order, uid }), "INVALID_UID"),
  );
for (const status of [
  "cancelled",
  "completed",
  "rejected",
  "processing",
  "approved",
])
  test("status blocked " + status, () =>
    blocked(() => generate({ ...order, status }), "ORDER_NOT_PENDING"),
  );
test("missing owner and cancellation evidence blocked", () => {
  blocked(() => generate({ ...order, user_id: null }), "ORDER_OWNER_MISSING");
  blocked(
    () => generate({ ...order, cancelled_at: "2026-01-01" }),
    "ORDER_CANCELLED",
  );
  blocked(() => generator.assertPreviewOrder(null), "ORDER_NOT_FOUND");
});
for (const payment_method of ["bkash", "nagad", "rocket", "upay"])
  test(payment_method + " blocked", () =>
    blocked(() => generate({ ...order, payment_method }), "PAYMENT_UNVERIFIED"),
  );
test("stored wallet casing handled", () =>
  assert.ok(generate({ ...order, payment_method: " Wallet " })));
test("missing and duplicate debit blocked", () => {
  blocked(() => generate(order, [pkg], []), "DEBIT_MISSING");
  blocked(
    () => generate(order, [pkg], [debit, { ...debit, id: order.id }]),
    "AMBIGUOUS_EVIDENCE",
  );
});
for (const change of [
  { user_id: order.id },
  { reference_id: order.user_id },
  { amount: 159 },
  { amount: "NaN" },
  { type: "adjustment" },
  { type: "purchase" },
  { direction: "credit" },
])
  test("conflicting debit " + JSON.stringify(change), () =>
    blocked(
      () => generate(order, [pkg], [{ ...debit, ...change }]),
      "CONFLICTING_EVIDENCE",
    ),
  );
test("refund and any additional financial evidence blocked", () => {
  blocked(
    () => generate(order, [pkg], [debit, { ...debit, type: "refund" }]),
    "REFUND_PRESENT",
  );
  blocked(
    () => generate(order, [pkg], [debit, { ...debit, type: "adjustment" }]),
    "AMBIGUOUS_EVIDENCE",
  );
});
for (const amount of ["NaN", "Infinity", "-1", "0", "158.001", "1e2"])
  test("invalid money " + amount, () =>
    blocked(() => generate({ ...order, amount }), "CONFLICTING_EVIDENCE"),
  );
for (const category of ["ff_likes", "indo_server", null])
  test("category blocked " + category, () =>
    blocked(() => generate(order, [{ ...pkg, category }]), "PACKAGE_UNMAPPED"),
  );
test("unknown UUID, renamed package, missing/ambiguous catalog fail closed", () => {
  blocked(
    () => generate(order, [{ ...pkg, id: order.id }]),
    "PACKAGE_UNMAPPED",
  );
  blocked(
    () =>
      generate({ ...order, package_name: "Renamed" }, [
        { ...pkg, name: "Renamed" },
      ]),
    "PACKAGE_UNMAPPED",
  );
  blocked(
    () => generate(order, [{ ...pkg, name: "Monthly" }]),
    "PACKAGE_UNRESOLVED",
  );
  blocked(() => generate(order, []), "PACKAGE_UNRESOLVED");
  blocked(() => generate(order, [pkg, pkg]), "PACKAGE_UNRESOLVED");
});
test("disabled mapping blocked", () => {
  const mapping = mappings.TOPUP_MAPPINGS[0];
  mapping.enabled = false;
  try {
    blocked(() => generate(), "PACKAGE_UNMAPPED");
  } finally {
    mapping.enabled = true;
  }
});
test("pure generation leaves all input evidence unchanged", () => {
  const before = JSON.stringify({ order, pkg, debit });
  generate();
  assert.equal(JSON.stringify({ order, pkg, debit }), before);
});
