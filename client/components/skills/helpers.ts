/**
 * Skills management helpers - ported from ntd
 */

// 根据文件扩展名返回对应图标颜色
export function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const colorMap: Record<string, string> = {
    md: '#0891b2',
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f7df1e',
    jsx: '#f7df1e',
    json: '#f59e0b',
    yaml: '#e11d48',
    yml: '#e11d48',
    toml: '#9333ea',
    txt: '#94a3b8',
    css: '#06b6d4',
    html: '#ea580c',
  };
  return colorMap[ext || ''] || '#94a3b8';
}

// 格式化文件大小
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 格式化时间
export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 30) {
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
    } else if (days > 0) {
      return `${days}天前`;
    } else if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else {
      return '刚刚';
    }
  } catch {
    return '-';
  }
}

// 分割技能名称（category/shortName）
export function splitSkillName(name: string): { category: string | null; shortName: string } {
  if (!name.includes('/')) return { category: null, shortName: name };
  const parts = name.split('/');
  return { category: parts[0], shortName: parts.slice(1).join('/') };
}

// 规范化执行器名称
export function normalizeExecutor(name: string): string {
  return name.toLowerCase().replace(/[_\s-]/g, '');
}

// 渐变背景色生成器
export function generateGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 60%), hsl(${h2}, 60%, 50%))`;
}

// 执行器颜色映射
export const EXECUTOR_COLORS: Record<string, string> = {
  claudecode: '#7C3AED',
  codebuddy: '#0891B2',
  opencode: '#059669',
  mobilecoder: '#DC2626',
  atomcode: '#D97706',
  hermes: '#7C3AED',
  kimi: '#2563EB',
  codex: '#10B981',
  pi: '#F59E0B',
  mimo: '#EC4899',
  zhanlu: '#8B5CF6',
  agents: '#6366F1',
};

// 导出任务状态
export interface ExportTask {
  id: string;
  skillName: string;
  status: 'pending' | 'exporting' | 'completed' | 'failed';
  progress: number;
  error?: string;
  blobUrl?: string;
}
