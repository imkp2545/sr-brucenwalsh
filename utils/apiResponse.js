class ApiResponse {
  static success(res, { statusCode = 200, message = 'Success', data = null, meta } = {}) {
    const body = { success: true, message, data };
    if (meta !== undefined) body.meta = meta;
    if (res.req?.id) body.requestId = res.req.id;
    return res.status(statusCode).json(body);
  }

  static error(
    res,
    { statusCode = 500, message = 'Internal server error', code = 'INTERNAL_SERVER_ERROR', details },
  ) {
    const body = { success: false, message, code };
    if (details !== undefined) body.details = details;
    if (res.req?.id) body.requestId = res.req.id;
    return res.status(statusCode).json(body);
  }
}

module.exports = ApiResponse;
