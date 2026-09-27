import type { WorkbenchNavigationGroup } from '../../workbench-core/index.js';

export const generatedNavigationGroups: readonly WorkbenchNavigationGroup<string>[] = Object.freeze([
]);
export const generatedInitialViewId = generatedNavigationGroups[0]?.items[0]?.id ?? null;
export const hasGeneratedViews = generatedInitialViewId !== null;
export function isGeneratedViewId(viewId: string): boolean {
  return generatedNavigationGroups.some((group) => group.items.some((item) => item.id === viewId));
}
export function generatedViewLabel(viewId: string): string {
  for (const group of generatedNavigationGroups) {
    const item = group.items.find((candidate) => candidate.id === viewId);
    if (item) return item.label;
  }
  return viewId;
}
