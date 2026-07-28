const PRODUCT_PROFILES = Object.freeze({
  "android-pilot": Object.freeze({
    describe: true,
    ocr: false,
    realtime: false,
    intent: false
  }),
  "product-dev": Object.freeze({
    describe: true,
    ocr: true,
    realtime: true,
    intent: true
  }),
  "intent-r26": Object.freeze({
    describe: false,
    ocr: false,
    realtime: false,
    intent: true
  })
});

export function resolveProductProfile(value = "intent-r26") {
  const name = value.trim().toLowerCase();
  const capabilities = PRODUCT_PROFILES[name];

  if (!capabilities) {
    throw new Error(
      `Unsupported VISIONASSIST_PROFILE "${value}". Expected one of: ${Object.keys(PRODUCT_PROFILES).join(", ")}.`
    );
  }

  return Object.freeze({
    name,
    capabilities
  });
}

export const supportedProductProfiles = Object.freeze(Object.keys(PRODUCT_PROFILES));
