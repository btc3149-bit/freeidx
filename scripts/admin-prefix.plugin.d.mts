/**
 * `admin-prefix.plugin.mjs` 的类型声明。
 *
 * 为什么必须有这个文件：
 *   插件本体是纯 JS（.mjs），好处是任意项目引入都不需要额外 tsconfig。
 *   但项目的构建链通常是 `tsc --noEmit && vite build`，`vite.config.ts` 在 tsconfig 的
 *   include 范围内 → tsc 检查那条 import 时找不到 .mjs 的类型声明，直接报
 *   `TS7016: Could not find a declaration file for module '...admin-prefix.plugin.mjs'`
 *   → **整个构建失败** → 部署不发生 → 客户以为「改了没生效」。
 *   实测踩到：freeidx 的 CI 就是这么挂的（apps/web 的 build = check-themes && tsc --noEmit && vite build）。
 *
 *   TypeScript 对 `.mjs` 文件会自动查找同目录的 `.d.mts`，所以本文件必须与插件同名同目录。
 */

/** 前缀文件名（默认值提交进仓库；Hub 改后缀就是改它） */
export declare const ADMIN_PREFIX_FILE: string;

/** 校验一个「后台前缀」是否可用；返回 null 表示通过，否则返回给客户看的原因 */
export declare function validateAdminPrefix(raw: string): string | null;

/** 找 `admin-prefix.txt`：先看项目根，再向上最多 3 层（兼容 monorepo 放仓库根） */
export declare function findPrefixFile(root: string): string | null;

/** 解析本次构建该用的前缀 */
export declare function resolveAdminPrefix(root: string): {
  prefix: string;
  source: 'env' | 'file' | 'default';
  warnings: string[];
  file: string | null;
};

/** 插件工厂：挂到 vite 的 plugins 数组里，必须排在 react/vue 之前（enforce:'pre'） */
export declare function adminPrefixPlugin(options?: {
  /** 覆盖 src 目录（默认 <root>/src） */
  srcDir?: string;
  /** 安静模式：不打印替换统计 */
  quiet?: boolean;
  /** 兼容旧参数，未使用 */
  repoRoot?: string;
}): {
  name: string;
  enforce: 'pre';
  configResolved(config: { root?: string; command?: string }): void;
  transform(code: string, id: string): { code: string; map: null } | null;
  buildEnd(): void;
};

export default adminPrefixPlugin;
