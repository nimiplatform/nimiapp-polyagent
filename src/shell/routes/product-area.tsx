import { WorkbenchCore, WorkbenchEmptyState } from '../../workbench-core/index.js';
import { appTitle } from '../auth/app-identity.js';
import { GeneratedModuleHost, GeneratedRouteRegistry } from '../../scaffold/generated/route-registry.js';
import {
  generatedInitialViewId,
  generatedNavigationGroups,
  hasGeneratedViews,
  isGeneratedViewId,
} from '../../scaffold/generated/navigation.js';
import { useCallback, useState } from 'react';

const VIEW_STORAGE_KEY = 'nimi.app.workbench-view.v1';

function readInitialViewId(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(VIEW_STORAGE_KEY);
    return stored && isGeneratedViewId(stored) ? stored : generatedInitialViewId;
  } catch {
    return generatedInitialViewId;
  }
}

export function ProductArea() {
  const [activeViewId, setActiveViewId] = useState<string | null>(readInitialViewId);
  const selectView = useCallback((viewId: string) => {
    if (!isGeneratedViewId(viewId)) return;
    setActiveViewId(viewId);
    try { globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, viewId); } catch { /* UI state remains session-local. */ }
  }, []);
  return (
    <GeneratedModuleHost onSelectView={selectView}>
      <WorkbenchCore<string>
      activeViewId={activeViewId}
      navigationLabel="App modules"
      navigationGroups={generatedNavigationGroups}
      onSelectView={selectView}
      rootTestId="nimi-app-workbench"
    >
        {hasGeneratedViews && activeViewId ? (
          <GeneratedRouteRegistry activeViewId={activeViewId} onSelectView={selectView} />
        ) : (
          <WorkbenchEmptyState
            appTitle={appTitle}
            eyebrow="Nimi App"
            title="Ready for product modules"
            description="This identity-neutral workbench is ready. Add a coarse product module when the App needs one."
            status="Runtime ready"
          />
        )}
      </WorkbenchCore>
    </GeneratedModuleHost>
  );
}
