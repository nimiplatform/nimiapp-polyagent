import { WorkbenchRuntimeGate } from '../workbench-core/index.js';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { PolyAgentApp } from '../polyagent/App.js';
import {
  appTitle,
  clearTargetRuntimeGate,
  resolveTargetRuntimeGate,
  targetRuntimeGateCopy,
  targetRuntimeGateErrorMessage,
} from './workbench-target-adapter.js';

export function App() {
  return (
    <>
      <WorkbenchRuntimeGate
        appTitle={appTitle}
        copy={targetRuntimeGateCopy}
        resolve={resolveTargetRuntimeGate}
        clear={clearTargetRuntimeGate}
        toErrorMessage={targetRuntimeGateErrorMessage}
      >
        <PolyAgentApp />
      </WorkbenchRuntimeGate>
      <NimiToaster />
    </>
  );
}
