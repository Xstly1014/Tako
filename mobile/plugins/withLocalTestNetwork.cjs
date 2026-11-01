// Only the USB reverse endpoint may use HTTP. All other hosts remain HTTPS-only.
const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = function withLocalTestNetwork(config) {
  config = withAndroidManifest(config, (value) => {
    const app = value.modResults.manifest.application[0].$;
    app["android:usesCleartextTraffic"] = "false";
    app["android:networkSecurityConfig"] = "@xml/tako_network_security";
    return value;
  });
  return withDangerousMod(config, [
    "android",
    async (value) => {
      const target = path.join(
        value.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(
        path.join(target, "tako_network_security.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`,
      );
      return value;
    },
  ]);
};
