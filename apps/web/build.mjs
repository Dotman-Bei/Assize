/**
 * Builds the static site. There is no server and no database: the page reads the
 * chain directly, which is the product's own claim applied to its own UI.
 *
 * PRD §17: no address is compiled in. `deployment.json` is copied from
 * `deployments/` at build time and fetched by the page at runtime, so no address
 * literal appears anywhere under `apps/` — `pnpm check:no-address-literals`
 * enforces that.
 */
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

const deployments = join(repoRoot, "deployments");
const record = readdirSync(deployments).find((f) => f.endsWith(".json"));
if (!record) throw new Error("no deployment record in deployments/");
writeFileSync(join(dist, "deployment.json"), readFileSync(join(deployments, record), "utf8"));

cpSync(join(here, "src", "index.html"), join(dist, "index.html"));
cpSync(join(here, "src", "styles.css"), join(dist, "styles.css"));

const options = {
  entryPoints: [join(here, "src", "main.js")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: join(dist, "app.js"),
  minify: !process.argv.includes("--serve"),
};

if (process.argv.includes("--single")) {
  // One file, no server, no network except the RPC. Open it by double-clicking.
  // Somnia's RPC sends `access-control-allow-origin: *` on both the call and the
  // preflight, so a page with a `null` file:// origin can still read the chain.
  await build({ ...options, minify: true, outfile: join(dist, "_inline.js") });
  const js = readFileSync(join(dist, "_inline.js"), "utf8");
  const css = readFileSync(join(here, "src", "styles.css"), "utf8");
  const record = readFileSync(join(dist, "deployment.json"), "utf8");
  // Replacements are passed as FUNCTIONS on purpose. A minified bundle contains
  // `$&` and `$'` sequences, and String.replace interprets those inside a
  // replacement *string* — which silently re-inserted the very <script src>
  // tag being replaced, three times. A replacer function disables that.
  const html = readFileSync(join(here, "src", "index.html"), "utf8")
    .replace('<link rel="stylesheet" href="./styles.css">', () => `<style>\n${css}\n</style>`)
    .replace(
      '<script type="module" src="./app.js"></script>',
      () => `<script>globalThis.__ASSIZE_DEPLOYMENT__ = ${record};</script>\n<script type="module">\n${js}\n</script>`,
    );
  writeFileSync(join(dist, "assize.html"), html);
  process.stdout.write(`built ${join(dist, "assize.html")}\n`);
} else if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
  createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const file = path === "/" ? "index.html" : path.slice(1);
    try {
      const body = readFileSync(join(dist, file));
      res.writeHead(200, { "content-type": types[extname(file)] ?? "text/plain" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  }).listen(5173, () => process.stdout.write("http://localhost:5173\n"));
} else {
  await build(options);
  process.stdout.write("built apps/web/dist\n");
}
