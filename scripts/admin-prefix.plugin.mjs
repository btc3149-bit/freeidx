/**
 * 后台前缀（admin prefix）构建期替换插件。
 *
 * 为什么要这个东西：
 *   后台路由 `/admin` 是硬编码在源码里的（App.tsx 的路由表、AdminLayout 的菜单、各页的分页与跳转链接）。
 *   想换成一个不可猜的后缀（例如 `/sys-7f3a9c`），逐个改源码既容易漏，也会让下一轮上游同步每处都冲突。
 *
 * 做法：源码里全部保持 `/admin` 字面量不动，**只在构建时**统一替换成实际前缀。
 *   前缀只有一个来源，按优先级：
 *     1. 环境变量 `VITE_ADMIN_PREFIX`（CI / 命令行临时覆盖）
 *     2. `admin-prefix.txt`（提交到仓库的默认值；CF-Deploy Hub 改后缀就是改这一行）
 *     3. 都没有 → `/admin`（等价于上游原样，不做任何替换）
 *   于是「换后台后缀」= 改一个值 + 重新构建，源码零改动，上游同步不冲突。
 *
 * 安全边界（和「盲目全局替换」的区别）：
 *   - 只替换**路径字面量开头**：引号紧跟 `/admin`，且后面不是字母数字下划线连字符。
 *     所以 `/administrator`、`/admin-panel` 这类别的路由不会被误伤；
 *     后端接口 `/api/admin/...` 也完全不受影响（引号后面是 `/api`，压根不匹配）。
 *   - 只处理 Vite 项目根下 `src/` 里的源文件；构建产物、node_modules、服务端目录一律不碰。
 *   - 前缀不合规直接让构建失败（而不是悄悄用一个错值上线）。
 *
 * 用法（一行）：
 *   import { adminPrefixPlugin } from './scripts/admin-prefix.plugin.mjs';
 *   plugins: [adminPrefixPlugin(), react()]
 *   // 必须排在会改写源码的插件（react/vue/svelte）之前：enforce:'pre' 已经保证了这点。
 *
 * 本文件是纯 JS（.mjs）：被任意项目引入都不需要额外 tsconfig 配置，也不会被类型检查挑刺。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 前缀文件名（默认值提交进仓库；Hub 改后缀就是改它） */
export const ADMIN_PREFIX_FILE = 'admin-prefix.txt';

/** 换后缀之后不允许撞上的站内真实路径，否则会把别人的目录顶掉 */
const RESERVED = new Set(['/', '/api', '/assets', '/static', '/favicon.ico', '/robots.txt']);

/** 合法前缀：`/` + 首字符字母数字，后续允许字母数字与 `. _ ~ -`，最长 64 */
const VALID = /^\/[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/;

/** 太好猜的后缀：不硬失败（会挡住自建用户手改），但构建日志里必须大声提醒 */
const WEAK = ['admin', 'login', 'manage', 'manager', 'dashboard', 'console', 'backend', 'root', 'system', 'admin1', 'test'];

/** 校验一个「后台前缀」是否可用；返回 null 表示通过，否则返回给客户看的原因 */
export function validateAdminPrefix(raw) {
  const p = String(raw ?? '').trim();
  if (!p) return '后台后缀不能为空';
  if (!p.startsWith('/')) return '必须以 / 开头，例如 /sys-7f3a9c';
  if (p.length > 1 && p.endsWith('/')) return '结尾不要带 /';
  if (p.includes('//')) return '不能出现连续的 //';
  if (p.includes('?')) return '不能带 ? 查询参数';
  if (/\s/.test(p)) return '不能包含空格';
  if (RESERVED.has(p)) return `${p} 是站点本来就有的路径，换到这里会顶掉它`;
  if (!VALID.test(p)) return '只能用字母、数字和 . _ ~ -，且第一个字符必须是字母或数字';
  if (p === '/admin') return null; // 合法：等于不改
  if (p.replace(/^\//, '').length < 4) return '太短了，至少 4 个字符才有「猜不到」的效果，例如 /sys-7f3a9c';
  return null;
}

/**
 * 找 admin-prefix.txt：先看 Vite 项目根，再向上最多 3 层（兼容 monorepo 把它放在仓库根）。
 * @param root Vite 项目根（configResolved 的 config.root，通常是 apps/web）
 */
export function findPrefixFile(root) {
  let dir = resolve(root);
  for (let i = 0; i < 4; i++) {
    const f = join(dir, ADMIN_PREFIX_FILE);
    if (existsSync(f)) return f;
    const up = dirname(dir);
    if (up === dir || up === resolve(dir, '..', '..')) break;
    dir = up;
  }
  return null;
}

/**
 * 解析本次构建该用的前缀。
 * @param root Vite 项目根目录
 */
export function resolveAdminPrefix(root) {
  const warnings = [];

  const weakWarn = (p) => {
    if (p === '/admin') return; // 默认值不算「弱」，别在每次普通构建里刷噪音
    const body = p.replace(/^\//, '').toLowerCase();
    if (WEAK.includes(body)) warnings.push(`${p} 太好猜了，等于没改；建议加几个随机字符，例如 /sys-7f3a9c`);
  };

  const fromEnv = process.env.VITE_ADMIN_PREFIX?.trim();
  if (fromEnv) {
    const bad = validateAdminPrefix(fromEnv);
    if (bad) {
      // CI 里给错值必须硬失败：悄悄退化成 /admin 会让客户以为自己改成功了
      throw new Error(`[admin-prefix] 环境变量 VITE_ADMIN_PREFIX=${JSON.stringify(fromEnv)} 不合规：${bad}`);
    }
    weakWarn(fromEnv);
    return { prefix: fromEnv, source: 'env', warnings, file: null };
  }

  const file = findPrefixFile(root);
  if (file) {
    const raw = readFileSync(file, 'utf8').trim();
    // 只取第一行（noUncheckedIndexedAccess 下 [0] 可能是 undefined，显式兜底）
    const value = (raw.split('\n')[0] ?? '').trim();
    if (value) {
      const bad = validateAdminPrefix(value);
      if (bad) throw new Error(`[admin-prefix] ${ADMIN_PREFIX_FILE} 里的 ${JSON.stringify(value)} 不合规：${bad}`);
      if (raw.includes('\n')) warnings.push(`${ADMIN_PREFIX_FILE} 有多行，只用第一行`);
      weakWarn(value);
      return { prefix: value, source: 'file', warnings, file };
    }
  }

  return { prefix: '/admin', source: 'default', warnings, file: null };
}

/**
 * Vite 插件工厂。
 * @param options.srcDir 覆盖默认的 `<root>/src`（少数项目源码不在 src 下时用）
 * @param options.quiet 静默日志
 */
export function adminPrefixPlugin(options = {}) {
  const { srcDir: srcOverride, quiet } = options;

  // configResolved 之前不知道 root，所以先占位，等到钩子里再解析
  let prefix = '/admin';
  let active = false;
  let srcDir = '';
  let resolved = false;

  // 只认「引号 + /admin + 边界」，见文件头注释
  const RE = /(['"`])\/admin(?![A-Za-z0-9_-])/g;
  const log = (...a) => { if (!quiet) console.log(...a); };

  let replaced = 0;
  const touched = new Set();

  return {
    name: 'admin-prefix',
    // 必须在 @vitejs/plugin-react / vue 之前跑：先改完字面量，再交给 JSX/TS 转换
    enforce: 'pre',

    configResolved(config) {
      if (resolved) return;
      resolved = true;
      const root = config.root || process.cwd();
      const r = resolveAdminPrefix(root);
      prefix = r.prefix;
      active = prefix !== '/admin';
      srcDir = (srcOverride || join(root, 'src')).replace(/\\/g, '/').replace(/\/+$/, '') + '/';

      const origin = r.source === 'env' ? 'VITE_ADMIN_PREFIX' : r.source === 'file' ? ADMIN_PREFIX_FILE : '默认值';
      if (active) log(`[admin-prefix] 后台路径 /admin → ${prefix}（来源：${origin}，${config.command}）`);
      else log('[admin-prefix] 后台路径保持 /admin（未配置前缀覆盖）');
      for (const w of r.warnings) console.warn(`[admin-prefix] ${w}`);
    },

    transform(code, id) {
      if (!active) return null;
      // split()[0] 可能 undefined，显式兜底（strict/noUncheckedIndexedAccess 下也要能过）
      const file = (id.replace(/\\/g, '/').split('?')[0] ?? '').toString();
      if (!file.startsWith(srcDir)) return null;
      // 别替换插件自己（里面就有 '/admin' 字面量和正则）
      if (file.endsWith('admin-prefix.plugin.mjs') || file.endsWith('admin-prefix.plugin.ts')) return null;
      if (!code.includes('/admin')) return null;

      const out = code.replace(RE, (_m, q) => `${q}${prefix}`);
      if (out === code) return null;

      replaced += (code.match(RE) || []).length;
      touched.add(file.slice(srcDir.length));
      return { code: out, map: null };
    },

    buildEnd() {
      if (!active || !replaced) return;
      log(`[admin-prefix] 共替换 ${replaced} 处，涉及 ${touched.size} 个文件`);
    },
  };
}

export default adminPrefixPlugin;
