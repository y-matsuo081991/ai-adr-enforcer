/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
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