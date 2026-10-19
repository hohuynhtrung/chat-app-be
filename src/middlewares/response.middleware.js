const responseMiddleware = (req, res, next) => {
  res.success = (data, statusCode = 200) => {
    res.status(statusCode).json({ success: true, data });
  };

  res.error = (message, statusCode = 400) => {
    res.status(statusCode).json({ success: false, message });
  };

  next();
};

module.exports = responseMiddleware;
