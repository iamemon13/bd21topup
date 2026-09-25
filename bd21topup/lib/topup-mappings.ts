import "server-only";

export const TOPUP_MAPPING_VERSION = "bd21-kaium-v1";
export type TopupCategory =
  "uid_bd" | "combo_offer" | "weekly_lite" | "level_up";
type SupplierItem =
  | "25"
  | "50"
  | "115"
  | "240"
  | "610"
  | "1240"
  | "2530"
  | "weekly"
  | "monthly"
  | "lite"
  | "lvl6"
  | "lvl10"
  | "lvl15"
  | "lvl20"
  | "lvl25"
  | "lvl30";
export type SupplierOperation = Readonly<{
  item: SupplierItem;
  quantity?: 1 | 2 | 3 | 4 | 5;
}>;
export type TopupMapping = Readonly<{
  packageId: string;
  expectedName: string;
  category: TopupCategory;
  enabled: boolean;
  operations: readonly SupplierOperation[];
}>;

// Owner-reviewed bindings. Never parse names/prices/code_name to create operations.
export const TOPUP_MAPPINGS: readonly TopupMapping[] = [
  {
    packageId: "95223d39-1880-4128-a222-08180089a229",
    expectedName: "Weekly",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "weekly" }],
  },
  {
    packageId: "99721284-0b1b-416e-a5e2-14b661eadb32",
    expectedName: "Monthly",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "monthly" }],
  },
  {
    packageId: "ae01ba14-3234-4fef-a4c2-95a582ff9968",
    expectedName: "25 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "25" }],
  },
  {
    packageId: "bacd7950-2c99-4a19-8c66-14d86e18ff5b",
    expectedName: "50 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "50" }],
  },
  {
    packageId: "54e6a71f-5a32-4cbd-a5fd-7140bed5da2c",
    expectedName: "115 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "115" }],
  },
  {
    packageId: "c68e2176-f42b-4b1e-b714-c31e203fc721",
    expectedName: "240 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "240" }],
  },
  {
    packageId: "871e33b3-01b4-4f91-9c95-3d5cf03f45e6",
    expectedName: "355 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "240" }, { item: "115" }],
  },
  {
    packageId: "9b89a6ec-cf8d-4c8a-9dc0-a07becf405c4",
    expectedName: "480 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "240", quantity: 2 }],
  },
  {
    packageId: "b0561547-3a49-46a9-9f0e-bbd455643534",
    expectedName: "505 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "240", quantity: 2 }, { item: "25" }],
  },
  {
    packageId: "4e1cc660-4945-4693-a3e2-3290f107e30c",
    expectedName: "610 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "610" }],
  },
  {
    packageId: "f82df3fd-2da0-4028-8a32-37f6beaaf1dd",
    expectedName: "850 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "610" }, { item: "240" }],
  },
  {
    packageId: "2f59437c-8f6d-4c66-839f-ac6df83ebaf9",
    expectedName: "1090 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "610" }, { item: "240", quantity: 2 }],
  },
  {
    packageId: "be4bae74-8dbf-4d9a-ae9a-849adb811c7b",
    expectedName: "1240 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "1240" }],
  },
  {
    packageId: "7ef8fadf-8197-43d4-845e-9f98c1462a1b",
    expectedName: "2090 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "1240" }, { item: "610" }, { item: "240" }],
  },
  {
    packageId: "b7235f00-8368-4558-a4b3-b6ffe3dc830c",
    expectedName: "2530 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "2530" }],
  },
  {
    packageId: "b6f1312a-6508-4f94-af05-a48d45dfeeef",
    expectedName: "5060 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "2530", quantity: 2 }],
  },
  {
    packageId: "33102353-1d9a-4937-bb3a-7b797c2ded06",
    expectedName: "10120 Diamond",
    category: "uid_bd",
    enabled: true,
    operations: [{ item: "2530", quantity: 4 }],
  },
  {
    packageId: "04948e15-7bee-491d-8db6-dbc398861967",
    expectedName: "1x Weekly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "weekly" }],
  },
  {
    packageId: "c32ca0f0-778d-40e3-a7da-83a2fc58e8b2",
    expectedName: "2x Weekly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "weekly", quantity: 2 }],
  },
  {
    packageId: "29140eb1-2d29-4b9b-a34b-f8d71f9b9955",
    expectedName: "3x Weekly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "weekly", quantity: 3 }],
  },
  {
    packageId: "993bab44-d1bf-4331-a20f-107405a279a4",
    expectedName: "4x Weekly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "weekly", quantity: 4 }],
  },
  {
    packageId: "01e81c8e-01ab-40d7-af36-352660b19f76",
    expectedName: "1x Monthly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "monthly" }],
  },
  {
    packageId: "7906c87d-827b-4fdd-9b2f-8c45ac0c0cce",
    expectedName: "1 Monthly + 1 Weekly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "monthly" }, { item: "weekly" }],
  },
  {
    packageId: "222168ef-c8e2-4401-9997-62df9866ef8d",
    expectedName: "1 Monthly + 4 Weekly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "monthly" }, { item: "weekly", quantity: 4 }],
  },
  {
    packageId: "b2bfec13-2553-4173-af1d-fe11ae184df9",
    expectedName: "2x Monthly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "monthly", quantity: 2 }],
  },
  {
    packageId: "3bbfcdbe-8ac2-42bb-be6d-cd065e24a35d",
    expectedName: "3x Monthly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "monthly", quantity: 3 }],
  },
  {
    packageId: "6c4bba03-9dbf-4843-80f6-4130e285a76a",
    expectedName: "4x Monthly",
    category: "combo_offer",
    enabled: true,
    operations: [{ item: "monthly", quantity: 4 }],
  },
  {
    packageId: "fd8341a6-ba2b-4578-9780-6fe8eaeaad99",
    expectedName: "1x Weekly Lite",
    category: "weekly_lite",
    enabled: true,
    operations: [{ item: "lite", quantity: 1 }],
  },
  {
    packageId: "0ccd017e-0cbe-4452-85e6-d1a6c8ad86e9",
    expectedName: "2x Weekly Lite",
    category: "weekly_lite",
    enabled: true,
    operations: [{ item: "lite", quantity: 2 }],
  },
  {
    packageId: "a158e780-cc8b-44bf-986b-3a72e3edc4db",
    expectedName: "3x Weekly Lite",
    category: "weekly_lite",
    enabled: true,
    operations: [{ item: "lite", quantity: 3 }],
  },
  {
    packageId: "a75690e6-3d0c-4d18-89a8-86c6b2ae0f77",
    expectedName: "5x Weekly Lite",
    category: "weekly_lite",
    enabled: true,
    operations: [{ item: "lite", quantity: 5 }],
  },
  {
    packageId: "d2872f8f-cf42-471c-b473-b6736aba3758",
    expectedName: "Level Up Package - Level 6",
    category: "level_up",
    enabled: true,
    operations: [{ item: "lvl6" }],
  },
  {
    packageId: "f8ecbbba-6776-4c37-b064-b3213c543de1",
    expectedName: "Level Up Package - Level 10",
    category: "level_up",
    enabled: true,
    operations: [{ item: "lvl10" }],
  },
  {
    packageId: "5e845458-ed7c-4095-adaa-d6246105f9bb",
    expectedName: "Level Up Package - Level 15",
    category: "level_up",
    enabled: true,
    operations: [{ item: "lvl15" }],
  },
  {
    packageId: "58b1af77-6ebc-4542-a279-1ecd01e3d958",
    expectedName: "Level Up Package - Level 20",
    category: "level_up",
    enabled: true,
    operations: [{ item: "lvl20" }],
  },
  {
    packageId: "78cc62f6-a354-4519-8430-fa643af00fd0",
    expectedName: "Level Up Package - Level 25",
    category: "level_up",
    enabled: true,
    operations: [{ item: "lvl25" }],
  },
  {
    packageId: "ea31ea9d-301b-463c-9b0f-3bdcbfa63c8f",
    expectedName: "Level Up Package - Level 30",
    category: "level_up",
    enabled: true,
    operations: [{ item: "lvl30" }],
  },
];

export function resolveTopupMapping(pkg: {
  id: string;
  name: string;
  category: string | null;
}) {
  return TOPUP_MAPPINGS.find(
    (mapping) =>
      mapping.enabled &&
      mapping.packageId === pkg.id &&
      mapping.expectedName === pkg.name &&
      mapping.category === pkg.category,
  );
}
