declare module "mapshaper" {
  /**
   * Programmatic mapshaper: runs a CLI command string against in-memory virtual files and
   * returns the outputs keyed by filename. No files touch disk.
   */
  const api: {
    applyCommands(
      commands: string,
      inputs?: Record<string, Buffer | string>,
    ): Promise<Record<string, Buffer | string>>;
  };
  export default api;
}
