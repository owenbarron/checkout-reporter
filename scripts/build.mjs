import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
await fs.mkdir(dist, { recursive: true });

const coreSource = await fs.readFile(path.join(root, "src/core.mjs"), "utf8");
const appSource = await fs.readFile(path.join(root, "src/bookmarklet.mjs"), "utf8");
const coreStandalone = coreSource
  .replace(/^const REPORT_TIME_ZONE/m, "const REPORT_TIME_ZONE")
  .replace(/export default\s*\{([\s\S]*?)\};\s*$/, "const Core = {$1};");
const appStandalone = appSource.replace(/^import Core from ".\/core\.mjs";\s*/, "");
const source = `(()=>{\n${coreStandalone}\n${appStandalone}\n})();\n`;
const bookmarklet = "javascript:" + encodeURIComponent(source);
const template = await fs.readFile(path.join(root, "src/install.template.html"), "utf8");
const installer = template.replace("__BOOKMARKLET__", bookmarklet.replaceAll("&", "&amp;").replaceAll('"', "&quot;"));
const mockTemplate = await fs.readFile(path.join(root, "src/mock-admin.template.html"), "utf8");
const mockAdmin = mockTemplate.replace("__BOOKMARKLET__", bookmarklet.replaceAll("&", "&amp;").replaceAll('"', "&quot;"));

await fs.writeFile(path.join(dist, "bookmarklet-source.js"), source);
await fs.writeFile(path.join(dist, "bookmarklet-url.txt"), bookmarklet);
await fs.writeFile(path.join(dist, "install.html"), installer);
await fs.writeFile(path.join(dist, "index.html"), installer);
await fs.writeFile(path.join(dist, "mock-admin.html"), mockAdmin);
console.log(JSON.stringify({
  sourceBytes: Buffer.byteLength(source),
  bookmarkletBytes: Buffer.byteLength(bookmarklet),
  installer: path.join(dist, "install.html"),
}, null, 2));
