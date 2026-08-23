// Vendored from LookatStudy src/renderer/lib/mermaid-elk-rewrite.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header (elkjs dynamic import target adapted to CDN).
/**
 * mermaid-elk-rewrite —— flowchart → flowchart-elk 前缀改写(v0.21 纯函数)。
 *
 * 只在渲染层改写:LLM 出题提示词(draw_diagram)与语法修复回路
 * (diagram-repair-service)都继续产出/接收**原版 flowchart 语法**,零改动;
 * renderMermaid 喂给 mermaid 前把 flowchart/graph 声明行改成 flowchart-elk ——
 * 同一套语法换 ELK 布局引擎(正交路由,复杂流程图边交叉显著少于 dagre)。
 *
 * mermaid 机制:flowchart-elk 前缀 → detector 置 config.layout="elk" → 查
 * registerLayoutLoaders 注册的 "elk" 算法;未注册则静默退 dagre 并 console.warn
 * (ui-test 靠该 warn 断言 ELK 真实生效)。
 *
 * 范围:只改首个内容行的 flowchart 家族声明;sequenceDiagram/stateDiagram-v2/
 * classDiagram 等其余图类型原样返回(ELK 布局只对 flowchart 家族注册)。
 */

/** 首个内容行(跳过空行与 %% 注释/`%%{init}%%` 指令行)的 flowchart 声明改为
 *  flowchart-elk;已是 flowchart-elk 则幂等返回;其他图类型不动。 */
export function rewriteFlowchartToElk(code: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    if (/^flowchart-elk\b/i.test(trimmed)) return code;
    if (/^(flowchart|graph)\b/i.test(trimmed)) {
      lines[i] = line.replace(/^(\s*)(flowchart|graph)\b/i, "$1flowchart-elk");
      return lines.join("\n");
    }
    // 首个内容行不是 flowchart 家族 → 其他图类型,不改写
    return code;
  }
  return code;
}
