export interface DesktopBaselineReport {
  sourceCommit: string;
  pagesCommit: string;
  includeRuntime: boolean;
  checkedCount: number;
  checked: string[];
}
export function verifyDesktopBaseline(options?: { projectRoot?: string; manifestPath?: string; includeRuntime?: boolean }): DesktopBaselineReport;
