module.exports = (err, req, res, next) => {
  if (err.status) return res.error(err.message, err.status);
  console.dir(err, { depth: 6 }); // in sâu hơn để thấy mục "cause" thật sự
  const message =
    process.env.NODE_ENV === "production" ? "Lỗi máy chủ" : err.message;
  res.error(message, 500);
};
