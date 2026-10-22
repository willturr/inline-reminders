import * as esbuild from "esbuild";

const production = process.argv.includes("production");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  external: ["obsidian", "@codemirror/*"],
  format: "cjs",
  platform: "browser",
  target: "es2018",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  banner: { js: "/* Inline Reminders v1.0.1 | MIT License */" }
});
if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
