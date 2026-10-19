module.exports = (err, req, res, next) => {
  if (err.status) return res.error(err.message, err.status);
  console.error(err);
  res.error("Lỗi máy chủ", 500);
};
