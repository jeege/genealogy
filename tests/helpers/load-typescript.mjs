import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const srcRoot = path.join(root, "src");

// 解析 "@/..." 别名到 src/，与 tsconfig 的 paths 保持一致。
function resolveAlias(specifier) {
  if (specifier.startsWith("@/")) {
    return path.join(srcRoot, specifier.slice(2));
  }
  return specifier;
}

// 用项目已有的 TypeScript 编译器转译单个模块，便于在 Node 中直接测试
// 纯逻辑（不依赖浏览器或真实数据库）。
export function loadTypeScript(relativePath, mocks = {}) {
  const filename = path.resolve(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (id) => {
    const resolved = resolveAlias(id);
    // 同时支持原样和别名解析后的 mock 键。
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (Object.hasOwn(mocks, resolved)) return mocks[resolved];
    return originalRequire(resolved);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}
