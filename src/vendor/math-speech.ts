/**
 * Vendored from LookatStudy shared/math-speech.ts (MIT License,
 * https://github.com/Kaiji-Z/LookatStudy), upstream v0.28.0. Unmodified
 * except this provenance header. zh-only by design upstream — the plugin's
 * read-aloud pipeline applies it for zh and strips $..$ delimiters for other
 * locales (conversion for more languages is future work).
 *
 * math-speech —— LaTeX 公式 → 中文口语(v0.19 朗读口语化,纯函数,verify 直测)。
 *
 * 只在**合成侧**应用(真正念出来的文本);karaoke 高亮/匹配层继续吃 `$..$` 原文
 * (DOM 侧 getTextModel 收 KaTeX annotation 的 TeX 源,两侧在 canonical 空间对齐)
 * ——念的是人话,亮的是原文,互不干扰。
 *
 * 规则表起步:常见记号(分式/根号/上下标/希腊字母/关系与算符)覆盖优先,
 * 未覆盖宏退化为逐字母(好于念"反斜杠 f-r-a-c")。
 */

/** 单符号命令 → 中文(长命令先试,避免 \le 被 \leq 截断)。 */
const SYMBOLS: Array<[string, string]> = [
  ["\\leq", "小于等于"], ["\\le", "小于等于"], ["\\geq", "大于等于"], ["\\ge", "大于等于"],
  ["\\neq", "不等于"], ["\\ne", "不等于"], ["\\approx", "约等于"], ["\\equiv", "恒等于"],
  ["\\pm", "正负"], ["\\times", "乘以"], ["\\cdot", "点乘"], ["\\div", "除以"],
  ["\\to", "趋于"], ["\\rightarrow", "趋于"], ["\\Rightarrow", "推出"],
  ["\\infty", "无穷"], ["\\sum", "求和"], ["\\prod", "连乘"], ["\\int", "积分"],
  ["\\lim", "极限"], ["\\log", "对数"], ["\\ln", "自然对数"], ["\\exp", "指数"],
  ["\\in", "属于"], ["\\subset", "包含于"], ["\\cup", "并"], ["\\cap", "交"],
  ["\\forall", "任意"], ["\\exists", "存在"], ["\\partial", "偏导"], ["\\nabla", "梯度"],
  ["\\angle", "角"], ["\\degree", "度"], ["\\cdots", "点点点"], ["\\ldots", "点点点"],
];

const GREEK: Record<string, string> = {
  alpha: "阿尔法", beta: "贝塔", gamma: "伽马", delta: "德尔塔", epsilon: "艾普西隆",
  zeta: "泽塔", eta: "伊塔", theta: "西塔", iota: "约塔", kappa: "卡帕", lambda: "拉姆达",
  mu: "缪", nu: "纽", xi: "克西", pi: "派", rho: "柔", sigma: "西格马", tau: "陶",
  phi: "斐", chi: "凯", psi: "普西", omega: "欧米伽",
};

/** 读取 `{...}` 花括号组(从 openIdx 的下一个字符起,返回内容与结束下标)。 */
function readGroup(s: string, i: number): { body: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** 单 token(花括号组或单字符)读取:返回 {body, end}。 */
function readAtom(s: string, i: number): { body: string; end: number } {
  const g = readGroup(s, i);
  if (g) return g;
  return { body: s[i] ?? "", end: i + 1 };
}

/** LaTeX 片段 → 中文口语(递归:命令参数体内再走一遍)。 */
export function mathToSpokenZH(tex: string): string {
  let s = tex;
  // 无参修饰先清
  s = s.replace(/\\(?:left|right|displaystyle|limits)\b/g, " ");
  s = s.replace(/\\[,;!\s]|\\quad|\\qquad|~/g, " ");

  // 带参命令(迭代到不动点,支持嵌套如 \frac{\alpha}{\beta})
  for (let guard = 0; guard < 12; guard++) {
    let next = s;
    // \frac{a}{b} 家族 → "a 分之 b";\binom → "a 取 b"(归一不许插空格,空格会被
    // readAtom 当成单字符参数吞掉首参)
    next = next.replace(/\\[dt]?frac(?![A-Za-z])/g, "\\frac");
    {
      let i: number;
      while ((i = next.indexOf("\\frac")) >= 0) {
        const a = readAtom(next, i + 5);
        const b = readAtom(next, a.end);
        next = next.slice(0, i) + `${a.body} 分之 ${b.body} ` + next.slice(b.end);
      }
    }
    {
      let i: number;
      while ((i = next.indexOf("\\binom")) >= 0) {
        const a = readAtom(next, i + 6);
        const b = readAtom(next, a.end);
        next = next.slice(0, i) + `${a.body} 取 ${b.body} ` + next.slice(b.end);
      }
    }
    // \sqrt[n]{x} / \sqrt{x}
    next = next.replace(/\\sqrt\s*\[( {[^{}]*} |[^\s\\]+)\s*\]\s*/g, (_m, n: string) => `${n.trim()} 次根号 `);
    {
      let i: number;
      while ((i = next.indexOf("\\sqrt")) >= 0) {
        const a = readAtom(next, i + 5);
        next = next.slice(0, i) + `根号 ${a.body} ` + next.slice(a.end);
      }
    }
    // 包裹命令(取内容):\text 直接留内容;\mathbf 等去壳
    next = next.replace(/\\(?:mathbf|mathbb|mathrm|mathit|boldsymbol|text|operatorname)\s*/g, (m) => (m.startsWith("\\text") ? "" : " "));
    if (next === s) { s = next; break; }
    s = next;
  }

  // 上下标:前一个原子 ^{..}/^c → "的 n 次方";_{..}/_c → "下标 n"
  for (let guard = 0; guard < 8; guard++) {
    const next = s.replace(
      /(\\frac|[\w)\]}]|\s)\s*\^\s*(\{[^{}]*\}|[^\s])|(\\frac|[\w)\]}]| )\s*_\s*(\{[^{}]*\}|[^\s])/g,
      (_m, base1: string | undefined, sup: string | undefined, base2: string | undefined, sub: string | undefined) => {
        if (sup !== undefined) return `${base1} 的 ${sup.replace(/[{}]/g, "")} 次方`;
        return `${base2} 下标 ${sub!.replace(/[{}]/g, "")}`;
      },
    );
    if (next === s) break;
    s = next;
  }

  // 符号与希腊字母(长命令优先)
  for (const [cmd, zh] of SYMBOLS) s = s.split(cmd).join(` ${zh} `);
  s = s.replace(/\\([A-Za-z]+)\b/g, (_m, name: string) => ` ${GREEK[name] ?? name} `);
  s = s.replace(/[{}]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** 句子级入口:把 `$..$`/`$$..$$` 段替换为口语;段外文本逐字节不变。 */
export function speakMathInSentence(sentence: string): string {
  return sentence.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$/g, (_m, block?: string, inline?: string) => {
    const spoken = mathToSpokenZH(block ?? inline ?? "");
    return spoken ? ` ${spoken} ` : "";
  });
}
