import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { validateWorkspace, type Workspace } from './model.js';
export interface WorkspaceStore {
  load(): Promise<Workspace | null>;
  save(value: Workspace): Promise<void>;
}
const file = 'polyagent/workspace.json';
export class NimiWorkspaceStore implements WorkspaceStore {
  constructor(readonly storage: NimiElectronAppBusinessServices['storage']) {}
  async load() {
    const entries = await this.storage.assets.list({ prefix: 'polyagent/', pageSize: 10 });
    if (!entries.assets.some((a) => a.relativePath === file)) {
      if (entries.nextCursor) throw new Error('账本目录未完整读取');
      return null;
    }
    const result = await this.storage.assets.read({ relativePath: file });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of result.body) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error('账本超过读取上限');
      chunks.push(chunk);
    }
    if (size !== result.asset.sizeBytes) throw new Error('账本读取不完整');
    const all = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    return validateWorkspace(JSON.parse(new TextDecoder().decode(all)));
  }
  async save(value: Workspace) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > 16 * 1024 * 1024) throw new Error('账本空间已满，停止增加订单并导出记录');
    await this.storage.assets.write({
      relativePath: file,
      body: bytes,
      mediaType: 'application/json',
      overwrite: true,
    });
  }
}
