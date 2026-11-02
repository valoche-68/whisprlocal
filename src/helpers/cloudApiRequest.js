function createCloudApiRequestHandler() {
  return async () => ({
    success: false,
    status: 0,
    code: "LOCAL_ONLY",
    error: "Official services are removed from WhisprLocal",
  });
}
module.exports = { createCloudApiRequestHandler };
