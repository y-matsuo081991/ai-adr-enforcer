/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    "^.+\\.[tj]sx?$": [
      "ts-jest",
      {
        tsconfig: {
          ignoreDeprecations: "6.0"
        },
        diagnostics: {
          ignoreCodes: [5107]
        }
      }
    ]
  }
};