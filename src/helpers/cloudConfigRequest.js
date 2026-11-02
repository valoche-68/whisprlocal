function createCloudConfigRequestHandler() {
  return async () => ({
    success: false,
    status: 0,
    code: "LOCAL_ONLY",
    error: "Use a local or self-hosted model",
  });
}
module.exports = { createCloudConfigRequestHandler };
