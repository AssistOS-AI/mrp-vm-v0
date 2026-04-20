export class ManagedLlmAdapter {
  async invoke(_payload) {
    throw new Error('ManagedLlmAdapter.invoke() must be implemented by a concrete adapter.');
  }
}
